import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ development: true }));

vi.mock("@/helpers/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/common")>();
  return { ...actual, isDevEnvironment: () => envState.development };
});

const deleteTestUserCompletely = vi.hoisted(() => vi.fn());

vi.mock("@/modules/e2e-support/helpers/delete-test-user.helper", () => ({
  deleteTestUserCompletely,
}));

import { createApp } from "@/app";

/**
 * DELETE /api/e2e/users/:email – delete a test account and everything it owns
 *
 * Auth required : No
 * Availability  : only mounted (and guarded) in development
 * Safety        : only *.bylddtest@test.com accounts are deletable
 */

describe("E2E support — DELETE /api/e2e/users/:email", () => {
  const app = createApp();

  beforeEach(() => {
    envState.development = true;
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Happy Path
  // =========================================================================

  it("deletes a test-suffixed account via the deletion helper", async () => {
    deleteTestUserCompletely.mockResolvedValue({
      deleted: true,
      userId: "user-id",
      companyDeleted: true,
      external: {},
      externalErrors: [],
      mongoDeleted: { user: 1, company: 1 },
    });

    const res = await request(app).delete(
      "/api/e2e/users/e2e-reset-123.bylddtest%40test.com",
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);
    expect(deleteTestUserCompletely).toHaveBeenCalledWith({
      email: "e2e-reset-123.bylddtest@test.com",
    });
  });

  it("responds 200 with deleted:false when the account does not exist (idempotent teardown)", async () => {
    deleteTestUserCompletely.mockResolvedValue({
      deleted: false,
      companyDeleted: false,
      external: {},
      externalErrors: [],
      mongoDeleted: {},
    });

    const res = await request(app).delete(
      "/api/e2e/users/e2e-gone.bylddtest%40test.com",
    );

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(false);
  });

  // =========================================================================
  // 2. Safety Guards
  // =========================================================================

  it("refuses to delete accounts without the test-email suffix", async () => {
    const res = await request(app).delete(
      "/api/e2e/users/real-person%40gmail.com",
    );

    expect(res.status).toBe(403);
    expect(deleteTestUserCompletely).not.toHaveBeenCalled();
  });

  it("is not reachable outside development", async () => {
    envState.development = false;

    const res = await request(app).delete(
      "/api/e2e/users/e2e-reset-123.bylddtest%40test.com",
    );

    expect(res.status).toBe(404);
    expect(deleteTestUserCompletely).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 3. Failure Propagation
  // =========================================================================

  it("returns 500 when the deletion helper throws", async () => {
    deleteTestUserCompletely.mockRejectedValue(new Error("mongo down"));

    const res = await request(app).delete(
      "/api/e2e/users/e2e-reset-123.bylddtest%40test.com",
    );

    expect(res.status).toBe(500);
  });
});
