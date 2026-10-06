import { createApp } from "@/app";
import { StripeConnectVendor } from "@/db/models/stripeConnect/vendor";
import {
  createVendor,
  getAllVendors,
} from "@/modules/stripe-connect/helpers/vendor.helper";
import { createSuperAdminSession } from "@/tests/utils/auth";
import request from "supertest";
import { describe, expect, it } from "vitest";

describe("vendors after retiring early transfers", () => {
  const app = createApp();

  it("creates and lists vendors without early-transfer fields, including legacy records", async () => {
    const session = await createSuperAdminSession();
    const vendor = await createVendor({
      userRef: session.user._id,
      companyRef: session.company._id,
      stripeAccountId: "acct_vendor",
    });
    expect(vendor.toObject()).not.toHaveProperty("amountOwedToPlatform");
    expect(vendor.toObject()).not.toHaveProperty("tier");
    await StripeConnectVendor.collection.updateOne(
      { _id: vendor._id },
      { $set: { tier: "tier2", amountOwedToPlatform: 250 } },
    );
    const result = await getAllVendors({});
    expect(JSON.stringify(result)).toContain("acct_vendor");
    expect(JSON.stringify(result)).not.toContain("tier");
    expect(JSON.stringify(result)).not.toContain("amountOwedToPlatform");
  });

  it("removes the endpoint for changing vendor tiers and platform debt", async () => {
    const session = await createSuperAdminSession();
    const vendor = await createVendor({
      userRef: session.user._id,
      companyRef: session.company._id,
      stripeAccountId: "acct_vendor",
    });
    const response = await request(app)
      .put("/api/super-admin/stripe/vendor/acct_vendor")
      .set("Cookie", session.cookie)
      .send({ tier: "tier2", amountOwedToPlatform: 250 });
    expect(response.status).toBe(404);
    const persisted = await StripeConnectVendor.findById(vendor._id).lean();
    expect(persisted).not.toBeNull();
    expect(persisted).not.toHaveProperty("tier");
    expect(persisted).not.toHaveProperty("amountOwedToPlatform");
  });
});
