import { faker } from "@faker-js/faker";

import { Company } from "@/db/models/company";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { OTP_PURPOSE, OtpVerificationModel } from "@/db/models/otpVerification";
import { User } from "@/db/models/user";
import { INVITED_USER_STATUS, USER_TYPE } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import { DEFAULT_TEST_OTP } from "@/modules/auth/__tests__/utils/auth-test.constant";

/**
 * Seeds an OTP the way saveOtp() does — the model's pre-save hook hashes the
 * code, so `otp` here is the raw code the caller will submit.
 */
export async function seedOtp({
  identifier,
  purpose,
  otp = DEFAULT_TEST_OTP,
  expiresInMs = 5 * 60 * 1000,
  attempts,
  isUsed,
}: {
  identifier: string;
  purpose: OTP_PURPOSE;
  otp?: string;
  expiresInMs?: number;
  attempts?: number;
  isUsed?: boolean;
}) {
  return OtpVerificationModel.create({
    identifier,
    otpCode: otp,
    purpose,
    expiresAt: new Date(Date.now() + expiresInMs),
    ...(attempts !== undefined && { attempts }),
    ...(isUsed !== undefined && { isUsed }),
  });
}

/** Seeds a live LOGIN-purpose OTP for `email`, exactly as requestOtp() stores it. */
export async function seedLoginOtp(email: string, otp = DEFAULT_TEST_OTP) {
  return seedOtp({ identifier: email, purpose: OTP_PURPOSE.LOGIN, otp });
}

/**
 * Seeds a company, an inviting admin, and a pending invitation for `invitedEmail`,
 * then returns the signed invite token the register endpoint expects.
 *
 * The token is signed with the real jwtHelper because validateInvitation() decodes
 * it and requires `decoded.email` to equal the registering email.
 */
export async function seedInvitation({
  invitedEmail,
  role = USER_TYPE.USER,
  status = INVITED_USER_STATUS.PENDING,
}: {
  invitedEmail: string;
  role?: USER_TYPE;
  status?: INVITED_USER_STATUS;
}) {
  const company = await Company.create({
    name: faker.company.name(),
    externalId: `org_${faker.string.alphanumeric(24)}`,
  });

  const inviter = await User.create({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    externalUserId: faker.string.uuid(),
    roles: USER_TYPE.ADMIN,
    companyRef: company._id,
  });

  await Company.findByIdAndUpdate(company._id, { userRef: inviter._id });

  const invitation = await InvitedUsers.create({
    invitedEmail,
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    userRef: inviter._id,
    companyRef: company._id,
    role,
    status,
  });

  return {
    company,
    inviter,
    invitation,
    inviteToken: jwtHelper.generateToken({ email: invitedEmail }),
  };
}
