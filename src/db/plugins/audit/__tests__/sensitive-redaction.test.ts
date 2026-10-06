import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import {
  buildExclusionSet,
  computeChanges,
  redactSnapshot,
} from "@/db/plugins/audit/audit-change";
import { scrubSensitiveKeys } from "@/db/plugins/audit/utils/sensitive-keys";
import { serializeAuditLogs } from "@/modules/audit-logs/utils/audit-log-serializer.util";
import type { IAuditLog } from "@/db/models/audit-logs/audit-log";

const exclude = buildExclusionSet();

describe("nested secret redaction (G)", () => {
  it("computeChanges drops a secret nested under a non-excluded parent", () => {
    const before = { profile: { name: "A", credentials: { password: "old" } } };
    const after = { profile: { name: "B", credentials: { password: "new" } } };

    const changes = computeChanges(before, after, exclude);
    const fields = changes.map((c) => c.field);
    expect(fields).toContain("profile.name");
    expect(fields.some((f) => f.includes("password"))).toBe(false);
  });

  it("redactSnapshot strips secrets at any depth", () => {
    const snapshot = redactSnapshot(
      {
        email: "a@b.test",
        auth: { passwordHash: "deadbeef", refreshToken: "rt" },
      },
      exclude,
    );
    expect(snapshot.email).toBe("a@b.test");
    expect(JSON.stringify(snapshot)).not.toContain("deadbeef");
    expect(JSON.stringify(snapshot)).not.toContain("rt");
  });

  it("scrubSensitiveKeys leaves Date and ObjectId leaves intact", () => {
    const id = new mongoose.Types.ObjectId();
    const when = new Date("2026-01-01T00:00:00.000Z");
    const out = scrubSensitiveKeys({ id, when, secret: "x" }) as Record<
      string,
      unknown
    >;
    expect(out.id).toBe(id);
    expect(out.when).toBe(when);
    expect(out.secret).toBeUndefined();
  });

  it("serializer scrubs a secret nested in metadata from JSON export", () => {
    const row = {
      _id: new mongoose.Types.ObjectId(),
      timestamp: new Date(),
      category: "record_change",
      action: "user.updated",
      status: "success",
      companyRef: new mongoose.Types.ObjectId(),
      actorId: new mongoose.Types.ObjectId(),
      actorEmail: "a@b.test",
      actorRole: "admin",
      targetType: "users",
      targetId: new mongoose.Types.ObjectId(),
      requestId: null,
      _sig: "sig",
      _prevSig: "ROOT",
      subsystemMappingVersion: 1,
      actor: { name: "Alice" },
      target: { label: null },
      context: { ip: null, userAgent: null, path: null, method: null },
      metadata: { snapshot: { token: "leak-me", email: "a@b.test" } },
      retentionDays: null,
    } as unknown as IAuditLog;

    const { body } = serializeAuditLogs([row], "json");
    const text = body.toString("utf-8");
    expect(text).not.toContain("leak-me");
    expect(text).toContain("a@b.test");
  });
});
