import mongoose from "mongoose";

import { Company, ICompanyDocument } from "@/db/models/company";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { Notification } from "@/db/models/notifications";
import { OtpVerificationModel } from "@/db/models/otpVerification";
import { Products } from "@/db/models/products";
import { RecoveryCodeModel } from "@/db/models/recoveryCodes";
import { ReferralReward } from "@/db/models/referral-reward";
import { Referrals } from "@/db/models/referrals";
import { RefreshToken } from "@/db/models/refreshToken";
import { Subscription } from "@/db/models/subscription";
import { IUserDocument, User } from "@/db/models/user";
import { UserNotificationPreference } from "@/db/models/userNotificationPreference";
import { UserQuery } from "@/db/models/userQuery";
import { E2E_CLEANUP_STATUS } from "@/modules/e2e-support/utils/e2e-support.enum";
import {
  IDeleteTestUserParams,
  IDeleteTestUserResult,
} from "@/modules/e2e-support/utils/e2e-support.types";
import { authService } from "@/providers/auth";
import { paymentGateway } from "@/providers/payment";
import { streamService } from "@/providers/stream-chat";

/**
 * Mongo transactions need a replica set. On a standalone instance (common for
 * local dev) withTransaction fails immediately — fall back to sequential deletes.
 */
function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /transaction numbers|replica set|transactions are not supported/i.test(
    message,
  );
}

/** Starting point for the external statuses: nothing attempted yet. */
function allSkippedExternals(): IDeleteTestUserResult["external"] {
  return {
    authProviderMembership: E2E_CLEANUP_STATUS.SKIPPED,
    authProviderUser: E2E_CLEANUP_STATUS.SKIPPED,
    authProviderOrganization: E2E_CLEANUP_STATUS.SKIPPED,
    streamChat: E2E_CLEANUP_STATUS.SKIPPED,
    stripeCustomer: E2E_CLEANUP_STATUS.SKIPPED,
  };
}

async function cleanupExternalAccounts(
  user: IUserDocument,
  ownedCompany: ICompanyDocument | null,
) {
  const external = allSkippedExternals();
  const errors: string[] = [];

  const attempt = async (
    target: keyof IDeleteTestUserResult["external"],
    run: () => Promise<unknown>,
  ) => {
    try {
      await run();
      external[target] = E2E_CLEANUP_STATUS.DELETED;
    } catch (error) {
      // "Not found" means an earlier (partial) cleanup already removed it.
      // Providers wrap SDK errors with { cause }, so check the whole chain.
      let notFound = false;
      const messages: string[] = [];
      for (
        let current: unknown = error;
        current;
        current = (current as { cause?: unknown }).cause
      ) {
        const message =
          current instanceof Error ? current.message : String(current);
        messages.push(message);
        notFound ||=
          /not.?found|no such|resource_missing/i.test(message) ||
          (current as { status?: number }).status === 404;
      }
      if (notFound) {
        external[target] = E2E_CLEANUP_STATUS.DELETED;
      } else {
        external[target] = E2E_CLEANUP_STATUS.FAILED;
        errors.push(`${target}: ${messages.join(" <- ")}`);
      }
    }
  };

  // Membership before user: the auth provider refuses to delete
  // organizations that still have members.
  if (user.organizationMembershipId) {
    await attempt("authProviderMembership", () =>
      authService.deleteOrganizationMembership(
        user.organizationMembershipId as string,
      ),
    );
  }
  if (user.externalUserId) {
    await attempt("authProviderUser", () =>
      authService.deleteUser(user.externalUserId as string),
    );
  }
  if (ownedCompany?.externalId) {
    await attempt("authProviderOrganization", () =>
      authService.deleteOrganization(ownedCompany.externalId as string),
    );
  }

  await attempt("streamChat", () =>
    streamService.deleteUser(user._id.toString()),
  );

  if (user.stripeCustomerId) {
    await attempt("stripeCustomer", () =>
      paymentGateway.deleteCustomer(user.stripeCustomerId as string),
    );
  }

  return { external, errors };
}

/**
 * Deletes a user and everything registration (and later usage) created for them:
 * local records, their single-member company, and external accounts (WorkOS
 * user/org/membership, Stream Chat, Stripe customer).
 *
 * External deletions run first and are idempotent — if the DB step fails,
 * a retry still has the external ids on the user record. Mongo deletes run in a
 * single transaction (sequential fallback on standalone instances).
 *
 * The company is only deleted when the user owns it AND no other members remain.
 */
export async function deleteTestUserCompletely({
  email,
}: IDeleteTestUserParams): Promise<IDeleteTestUserResult> {
  const user = await User.findOne({ email });
  if (!user) {
    return {
      deleted: false,
      companyDeleted: false,
      external: allSkippedExternals(),
      externalErrors: [],
      mongoDeleted: {},
    };
  }

  const userId = user._id;

  let ownedCompany = user.companyRef
    ? await Company.findOne({ _id: user.companyRef, userRef: userId })
    : null;
  if (ownedCompany) {
    const otherMembers = await User.countDocuments({
      companyRef: ownedCompany._id,
      _id: { $ne: userId },
    });
    if (otherMembers > 0) ownedCompany = null;
  }

  const { external, errors } = await cleanupExternalAccounts(
    user,
    ownedCompany,
  );

  let mongoDeleted: Record<string, number> = {};
  const deleteDbRecords = async (session?: mongoose.ClientSession) => {
    const options = session ? { session } : {};
    const counts: Record<string, number> = {};
    const remove = async (
      name: string,
      query: Promise<{ deletedCount?: number }>,
    ) => {
      counts[name] = (await query).deletedCount ?? 0;
    };

    await remove("refreshTokens", RefreshToken.deleteMany({ userId }, options));
    await remove(
      "recoveryCodes",
      RecoveryCodeModel.deleteMany({ userRef: userId }, options),
    );
    await remove(
      "otpVerifications",
      OtpVerificationModel.deleteMany({ identifier: email }, options),
    );
    await remove(
      "notifications",
      Notification.deleteMany({ userRef: userId }, options),
    );
    await remove(
      "notificationPreferences",
      UserNotificationPreference.deleteMany({ userRef: userId }, options),
    );
    await remove(
      "userQueries",
      UserQuery.deleteMany({ userRef: userId }, options),
    );
    await remove(
      "invitedUsers",
      InvitedUsers.deleteMany(
        { $or: [{ invitedEmail: email }, { userRef: userId }] },
        options,
      ),
    );
    await remove(
      "referrals",
      Referrals.deleteMany(
        { $or: [{ referredByRef: userId }, { referredToRef: userId }] },
        options,
      ),
    );
    await remove(
      "referralRewards",
      ReferralReward.deleteMany({ userRef: userId }, options),
    );
    await remove(
      "subscriptions",
      Subscription.deleteMany({ userRef: userId }, options),
    );

    if (ownedCompany) {
      const companyRef = ownedCompany._id;
      await remove(
        "companyProducts",
        Products.deleteMany({ companyRef }, options),
      );
      await remove(
        "companyInvites",
        InvitedUsers.deleteMany({ companyRef }, options),
      );
      await remove(
        "companySubscriptions",
        Subscription.deleteMany({ companyRef }, options),
      );
      await remove("company", Company.deleteOne({ _id: companyRef }, options));
    }

    await remove("user", User.deleteOne({ _id: userId }, options));
    return counts;
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      mongoDeleted = await deleteDbRecords(session);
    });
  } catch (error) {
    if (!isTransactionUnsupported(error)) throw error;
    mongoDeleted = await deleteDbRecords();
  } finally {
    await session.endSession();
  }

  return {
    deleted: true,
    userId: userId.toString(),
    companyDeleted: !!ownedCompany,
    external,
    externalErrors: errors,
    mongoDeleted,
  };
}
