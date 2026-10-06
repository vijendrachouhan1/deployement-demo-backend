import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ development: true }));

vi.mock("@/helpers/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/common")>();
  return { ...actual, isDevEnvironment: () => envState.development };
});

import { createApp } from "@/app";
import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";
import { clearCapturedEmails } from "@/providers/email/local-email.store";
import { LocalEmailProvider } from "@/providers/email/local.provider";

/**
 * GET    /api/e2e/emails  – read emails captured by the local email provider
 * DELETE /api/e2e/emails  – clear the captured mailbox
 *
 * Auth required : No
 * Availability  : only mounted (and guarded) in development
 */

describe("E2E support — /api/e2e/emails", () => {
  const app = createApp();
  const provider = new LocalEmailProvider();

  beforeEach(() => {
    envState.development = true;
    clearCapturedEmails();
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path
  // =========================================================================

  it("returns emails captured by the local provider", async () => {
    await provider.sendEmail({
      to: "e2e-user@bylddtest.local",
      subject: "Reset your password",
      html: "<a href='http://localhost:3000/reset-password?token=abc'>reset</a>",
    });

    const res = await request(app).get("/api/e2e/emails");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.emails).toHaveLength(1);
    expect(res.body.data.emails[0]).toMatchObject({
      to: ["e2e-user@bylddtest.local"],
      subject: "Reset your password",
    });
    expect(res.body.data.emails[0].html).toContain("reset-password?token=abc");
    expect(res.body.data.emails[0].sentAt).toBeTruthy();
  });

  it("captures template emails with template name and data", async () => {
    await provider.sendTemplateEmail({
      to: "e2e-user@bylddtest.local",
      templateName: EMAIL_TEMPLATE_NAME.VERIFY_OTP,
      templateData: { otp: "1234" },
    });

    const res = await request(app).get("/api/e2e/emails");

    expect(res.status).toBe(200);
    expect(res.body.data.emails[0]).toMatchObject({
      templateName: EMAIL_TEMPLATE_NAME.VERIFY_OTP,
      templateData: { otp: "1234" },
    });
  });

  it("filters by recipient (case-insensitive) via ?to=", async () => {
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "For A" });
    await provider.sendEmail({ to: "b@bylddtest.local", subject: "For B" });

    const res = await request(app)
      .get("/api/e2e/emails")
      .query({ to: "A@BYLDDTEST.LOCAL" });

    expect(res.status).toBe(200);
    expect(res.body.data.emails).toHaveLength(1);
    expect(res.body.data.emails[0].subject).toBe("For A");
  });

  it("returns newest first and honours ?limit=", async () => {
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "first" });
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "second" });

    const res = await request(app).get("/api/e2e/emails").query({ limit: "1" });

    expect(res.status).toBe(200);
    expect(res.body.data.emails).toHaveLength(1);
    expect(res.body.data.emails[0].subject).toBe("second");
  });

  it("clears the mailbox on DELETE", async () => {
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "old" });

    const del = await request(app).delete("/api/e2e/emails");
    expect(del.status).toBe(200);

    const res = await request(app).get("/api/e2e/emails");
    expect(res.body.data.emails).toHaveLength(0);
  });

  // =========================================================================
  // 2. Confused / empty states
  // =========================================================================

  it("returns an empty list for an unknown recipient", async () => {
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "For A" });

    const res = await request(app)
      .get("/api/e2e/emails")
      .query({ to: "nobody@bylddtest.local" });

    expect(res.status).toBe(200);
    expect(res.body.data.emails).toHaveLength(0);
  });

  it("ignores an invalid ?limit=", async () => {
    await provider.sendEmail({ to: "a@bylddtest.local", subject: "kept" });

    const res = await request(app)
      .get("/api/e2e/emails")
      .query({ limit: "not-a-number" });

    expect(res.status).toBe(200);
    expect(res.body.data.emails).toHaveLength(1);
  });

  // =========================================================================
  // 3. Malicious / environment guard
  // =========================================================================

  it("returns 404 outside development even if the router is mounted", async () => {
    envState.development = false;

    const res = await request(app).get("/api/e2e/emails");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
