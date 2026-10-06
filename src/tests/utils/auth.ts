import { Company, ICompanyDocument } from "@/db/models/company";
import { Products } from "@/db/models/products";
import { IUserDocument, User } from "@/db/models/user";
import { PERMISSIONS, STATUS, USER_TYPE } from "@/enums";
import { jwtHelper } from "@/helpers/jwt";
import { faker } from "@faker-js/faker";
import mongoose from "mongoose";

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * Permissions granted per role, mirroring what the WorkOS-backed
 * generateAuthTokens() bakes into a real session token. USER gets none so
 * permission-gated admin routes correctly reject it.
 */
const ROLE_PERMISSIONS: Record<USER_TYPE, PERMISSIONS[]> = {
  [USER_TYPE.SUPER_ADMIN]: ALL_PERMISSIONS,
  [USER_TYPE.ADMIN]: ALL_PERMISSIONS,
  [USER_TYPE.SYSTEM]: ALL_PERMISSIONS,
  [USER_TYPE.USER]: [],
};

export interface ITestSession {
  user: IUserDocument;
  company: ICompanyDocument;
  token: string;
  /** Formatted as "token=<jwt>" — pass to .set("Cookie", session.cookie) */
  cookie: string;
  /** Formatted as "Bearer <jwt>" — pass to .set("Authorization", ...) */
  bearerHeader: string;
}

export async function createTestSession(
  role: USER_TYPE = USER_TYPE.ADMIN,
  extras: Record<string, unknown> = {},
  // Override the role's default permission set — for tests that need a
  // partial-permission principal (e.g. has view but not manage).
  permissions?: PERMISSIONS[],
): Promise<ITestSession> {
  // 1. Create a Company. externalId is required by generateAuthTokens (the
  // WorkOS org id) — real companies always have it once synced.
  const company = await Company.create({
    name: faker.company.name(),
    companyStatus: STATUS.ACTIVE,
    externalId: `org_${faker.string.alphanumeric(24)}`,
  });

  // 2. Create a User linked to that Company
  const user = await User.create({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    externalUserId: faker.string.uuid(),
    hasPassword: true,
    roles: role,
    status: STATUS.ACTIVE,
    companyRef: company._id,
    ...extras,
  });

  // 3. Link company back to user
  await Company.findByIdAndUpdate(company._id, { userRef: user._id });

  // 4. Generate JWT (same payload the real app issues via generateAuthTokens):
  // orgId and permissions are required by jwtDecoder + authorize to accept it.
  const token = jwtHelper.generateToken({
    _id: user._id.toString(),
    email: user.email,
    orgId: company._id.toString(),
    permissions: permissions ?? ROLE_PERMISSIONS[role] ?? [],
  });

  return {
    user,
    company: company as ICompanyDocument,
    token,
    cookie: `token=${token}`,
    bearerHeader: `Bearer ${token}`,
  };
}

/**
 * A second principal inside an existing session's company — company scoping
 * cannot tell these two apart.
 */
export async function createColleagueSession(
  session: ITestSession,
  role: USER_TYPE = USER_TYPE.ADMIN,
  permissions?: PERMISSIONS[],
): Promise<ITestSession> {
  const user = await User.create({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    externalUserId: faker.string.uuid(),
    hasPassword: true,
    roles: role,
    status: STATUS.ACTIVE,
    companyRef: session.company._id,
  });

  const token = jwtHelper.generateToken({
    _id: user._id.toString(),
    email: user.email,
    orgId: session.company._id.toString(),
    permissions: permissions ?? ROLE_PERMISSIONS[role] ?? [],
  });

  return {
    user,
    company: session.company,
    token,
    cookie: `token=${token}`,
    bearerHeader: `Bearer ${token}`,
  };
}

/**
 * A principal with no companyRef at all — the shape `otp.helper.ts` creates on
 * phone login. Company-scoped reads find nothing for this user, and anything
 * requiring a companyRef to write cannot record what it just did.
 */
export async function createCompanylessSession(
  role: USER_TYPE = USER_TYPE.ADMIN,
  extras: Record<string, unknown> = {},
  permissions?: PERMISSIONS[],
): Promise<Omit<ITestSession, "company">> {
  const user = await User.create({
    email: faker.internet.email().toLowerCase(),
    name: { first: faker.person.firstName(), last: faker.person.lastName() },
    externalUserId: faker.string.uuid(),
    hasPassword: true,
    roles: role,
    status: STATUS.ACTIVE,
    ...extras,
  });

  // orgId is left off deliberately: jwtDecoder compares it against the user's
  // populated companyRef, and both being absent is what a real token for this
  // user looks like.
  const token = jwtHelper.generateToken({
    _id: user._id.toString(),
    email: user.email,
    permissions: permissions ?? ROLE_PERMISSIONS[role] ?? [],
  });

  return {
    user,
    token,
    cookie: `token=${token}`,
    bearerHeader: `Bearer ${token}`,
  };
}

export const createAdminSession = () => createTestSession(USER_TYPE.ADMIN);

export const createSuperAdminSession = () =>
  createTestSession(USER_TYPE.SUPER_ADMIN);

export const createUserSession = () => createTestSession(USER_TYPE.USER);

export async function seedProduct(
  companyId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return Products.create({
    title: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    price: parseFloat(faker.commerce.price()),
    companyRef: companyId,
    ...overrides,
  });
}
