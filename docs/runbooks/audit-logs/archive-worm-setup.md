# Runbook — Audit-log archive: write-once protection and retention

The audit-log archive stores expired audit rows as Parquet in S3 (see
[archive-table-setup.md](./archive-table-setup.md) for the Athena table). This runbook covers the
**bucket configuration** that makes that archive tamper-proof and gives it an expiry date.

Run it **once per environment**, in the same sitting as the archive table setup.

> **This boilerplate does not and cannot configure this for you.** The archive bucket lives in your
> AWS account, not in this repository. Nothing here is applied automatically — if you enable the
> archive (`AUDIT_ARCHIVE_BUCKET`) without doing this, your audit archive is deletable by anyone
> holding an AWS key for it.

## Why it is needed

Audit rows are hash-chained (`_sig` / `_prevSig`), so **editing** a row breaks the chain and
verification catches it. Deleting the newest archive files does not — what remains is a valid,
shorter chain, and nothing signals that anything is missing.

Two different properties, two different mechanisms:

| Property                              | Threat                    | Mechanism                         |
| ------------------------------------- | ------------------------- | --------------------------------- |
| Content integrity — no row was edited | Someone rewrites history  | Hash chain — already in the code  |
| Existence — no row was destroyed      | Someone deletes the files | S3 Object Lock — **this runbook** |

There is deliberately no application-side check for this. The application is the thing being
audited; code asserting "the archive is protected" proves nothing, because whoever can delete the
archive can also edit that code. The guarantee is only credible when enforced somewhere the
application cannot override, which is what Object Lock in Compliance mode provides — AWS refuses
the delete even for the account root.

Relevant frameworks: SOC 2 log retention (WORM), HIPAA §164.316(b)(2)(i) (six-year minimum).

## Decide these first

| Decision         | Guidance                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Retention period | HIPAA requires **6 years** minimum; SOC 2 sets no fixed number. **7 years (2555 days)** covers both. Use your own legal basis if you have one |
| Lock mode        | **Compliance** in production — irreversible, nobody including root can delete before expiry. **Governance** in staging so it stays testable   |

Do not enable Object Lock until both are settled. Compliance mode cannot be undone.

---

## Step 1 — Give Athena its own results bucket (do this FIRST)

Object Lock's default retention applies to the **whole bucket** and cannot be scoped to a prefix.
If `ATHENA_OUTPUT_LOCATION` points inside the archive bucket, every throwaway query result becomes
undeletable for the full retention period, with no way to clean it up.

1. Create a separate bucket, e.g. `<company>-athena-results`, in the same region as the archive bucket.
2. Lifecycle rule on it: expire objects after **7 days**. The application reads query results through
   the Athena API, never from S3, so these files matter only for console debugging — and they contain
   audit rows in plaintext CSV, so short retention is the safer default.
3. Set the env var in every environment:

   ```bash
   ATHENA_OUTPUT_LOCATION=s3://<company>-athena-results/
   ```

Do **not** reuse the upload bucket (`S3_BUCKET_NAME`) for this. Athena result files contain audit
rows, and the upload bucket is the one exposed to client-supplied keys via the presigned-upload
endpoint.

## Step 2 — Enable write-once protection on the archive bucket

On `AUDIT_ARCHIVE_BUCKET`:

1. Enable **Bucket Versioning** (Object Lock requires it).
2. Enable **Object Lock**.
3. Set **Default retention**: mode `Compliance` (production) or `Governance` (staging),
   duration **2555 days**.

If the console will not enable Object Lock on an existing bucket, create a new bucket with Object
Lock checked at creation, copy the existing `archive/` objects across, update `AUDIT_ARCHIVE_BUCKET`,
and re-run `npm run audit:archive-setup` — the Athena table `LOCATION` is derived from that env var,
so the table must be recreated against the new bucket.

## Step 3 — Add lifecycle rules to the archive bucket

| Rule name             | Scope             | Action                                                |
| --------------------- | ----------------- | ----------------------------------------------------- |
| `archive-to-cold`     | prefix `archive/` | Transition to Glacier Instant Retrieval after 90 days |
| `expire-archive`      | prefix `archive/` | Expire current versions after 2555 days               |
| `expire-old-versions` | prefix `archive/` | Expire noncurrent versions after 2555 days            |
| `abort-multipart`     | whole bucket      | Abort incomplete multipart uploads after 7 days       |

Use Glacier **Instant Retrieval**, not Deep Archive — Athena queries Instant Retrieval directly,
whereas Deep Archive would require restore-and-poll logic the cold reader does not have.

The expiry period must not be **shorter** than the lock duration. Lifecycle cannot delete a locked
object, so a shorter rule fails silently and the objects stay forever.

## Step 4 — Deny deletes at the IAM layer as well

Add a bucket policy on the archive bucket denying the application's IAM identity:

- `s3:DeleteObject`
- `s3:DeleteObjectVersion`
- `s3:PutObjectRetention`
- `s3:PutBucketVersioning`

Redundant with Object Lock on purpose. It is the layer that still holds in staging, where the lock
is reversible, and it protects against the lock being weakened later.

## Step 5 — Continuous evidence with AWS Config

Object Lock proves the control is on **today**. A SOC 2 Type II audit covers 6–12 months and needs
proof it held throughout — if someone disables a lifecycle rule in month three, that is a finding.

Enable AWS Config on the archive bucket with these managed rules:

- `s3-bucket-versioning-enabled`
- `s3-bucket-default-lock-enabled`
- `s3-lifecycle-policy-check`

Config keeps a compliance timeline automatically, and sits outside the application's privilege
boundary, so its record is credible in a way an in-application check would not be.

---

## Verify

1. Try to delete any object under `archive/` in the S3 console — it must fail with access denied.
2. Run an Athena query against `audit_archive` — it must still return rows.
3. Run the audit chain verification end to end — it must still pass.
4. Confirm all three AWS Config rules report compliant.

## Notes

- **Retries create locked versions.** Archive object keys are deterministic
  (`batch-<firstId>.parquet`) so a retried upload overwrites rather than duplicating rows. Under
  versioning that becomes a new version, which Object Lock permits and Athena reads correctly — but
  the superseded version is also locked and billed for the full retention. The
  `expire-old-versions` rule in Step 3 bounds that.
- **Nothing in the application deletes archive objects.** `S3Provider.delete()` is hardcoded to the
  upload bucket and never accepts an override. The risk this runbook addresses is raw AWS key
  access, not application behaviour.
- **Glacier Instant Retrieval has a 90-day minimum billing duration** per object. Irrelevant at a
  multi-year retention, but worth knowing if you shorten the period.
