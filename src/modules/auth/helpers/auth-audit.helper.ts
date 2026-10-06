import mongoose from "mongoose";

import {
  AuditContext,
  runWithSubsystem,
} from "@/db/plugins/audit/audit-context";
import type { IAuditPrincipal } from "@/db/plugins/audit/utils/audit.types";
import { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";
import { User } from "@/db/models/user";
import { USER_TYPE } from "@/enums";
import { AuditAction, AuditCategory, AuditStatus } from "@/enums/audit.enum";
import { jwtHelper } from "@/helpers/jwt";
import { safeEmit } from "@/modules/audit-logs/helpers/emit.helper";
import { AUTH_RESPONSE_MESSAGES } from "@/modules/auth/utils/auth.constant";

/*
 * The subset of a user needed to attribute an auth entry to its actor. Shared
 * by the login response user and the doc logout re-reads from its access token.
 */
type TAuditActor = {
  _id: mongoose.Types.ObjectId;
  email?: string | null;
  roles: USER_TYPE;
  companyRef?: mongoose.Types.ObjectId | null;
  name?: { first?: string; last?: string } | null;
};

function toPrincipal(user: TAuditActor): IAuditPrincipal {
  const name = [user.name?.first, user.name?.last]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    _id: user._id,
    companyRef: user.companyRef ?? null,
    role: user.roles,
    email: user.email ?? null,
    name: name || user.email || null,
  };
}

/*
 * Auth routes run unauthenticated, so AuditContext holds no principal yet. Seed
 * one from the just-authenticated user (mirrors middleware/auth.ts) so the entry
 * routes to the tenant chain, then emit.
 */
function emitAuthSuccess(user: TAuditActor, action: AuditAction): void {
  AuditContext.get().principal = toPrincipal(user);
  safeEmit({
    action,
    category: AuditCategory.AUTHENTICATION,
    status: AuditStatus.SUCCESS,
  });
}

export const emitLoginSuccess = (user: TAuditActor): void =>
  emitAuthSuccess(user, AuditAction.USER_LOGIN_SUCCESS);

export const emitLoginMfaRequired = (user: TAuditActor): void =>
  emitAuthSuccess(user, AuditAction.USER_LOGIN_MFA_REQUIRED);

/*
 * Logout has no auth middleware, so recover the actor from the access token to
 * route the entry to the tenant chain. Best-effort: an absent/expired token
 * just skips the entry — logout itself still succeeds.
 */
export async function emitLogout(accessToken?: string): Promise<void> {
  if (!accessToken) return;
  try {
    const { _id } = jwtHelper.verifyToken(accessToken);
    if (!_id) return;

    const actor = await User.findById(_id)
      .select("companyRef roles name email")
      .lean();

    if (actor) emitAuthSuccess(actor, AuditAction.USER_LOGOUT);
  } catch {
    // invalid/expired access token — nothing to attribute the logout to
  }
}

/*
 * Collapse every credential failure to one reason so the log can't reveal
 * whether the email exists or which factor failed (anti-enumeration). Only
 * account-status failures get their own bucket.
 */
function sanitizeFailureReason(rawReason?: string): string {
  switch (rawReason) {
    case AUTH_RESPONSE_MESSAGES.ACCOUNT_DELETED:
    case AUTH_RESPONSE_MESSAGES.ACCOUNT_DISABLED:
      return "Account inactive";
    default:
      return "Invalid credentials";
  }
}

/*
 * No authenticated principal on a failed login, so wrap in the AUTH subsystem
 * to route the entry to the AUTH sentinel chain.
 */
export function emitLoginFailure(
  email: string | undefined,
  rawReason?: string,
): void {
  runWithSubsystem(SystemSubsystem.AUTH, () =>
    safeEmit({
      action: AuditAction.USER_LOGIN_FAILURE,
      category: AuditCategory.AUTHENTICATION,
      status: AuditStatus.FAILURE,
      target: { label: email ?? null },
      failureReason: sanitizeFailureReason(rawReason),
    }),
  );
}
