import { Company, ICompany } from "@/db/models/company";
import { RefreshToken } from "@/db/models/refreshToken";
import { IUser } from "@/db/models/user";
import { jwtHelper } from "@/helpers/jwt";
import { workos } from "@/providers/auth/authkit.provider";
import { SignOptions } from "jsonwebtoken";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { LOGIN_METHOD } from "@/modules/auth/utils/auth.enum";

/**
 * Generate a new refresh token and save it to the database
 * @param userId User's ID
 * @param expiresInDays Number of days the token is valid for
 * @returns The generated plain text token
 */
export async function generateAndSaveRefreshToken(
  userId: mongoose.Types.ObjectId | string,
  expiresInDays: number = 7,
  loginMethod?: LOGIN_METHOD,
): Promise<string> {
  // Generate a random hex string
  const token = crypto.randomBytes(40).toString("hex");

  // Calculate expiration date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  // Save to DB
  await RefreshToken.create({
    userId: userId,
    token,
    expiresAt,
    loginMethod,
  });

  return token;
}

export async function resolveUserPermissions(user: IUser) {
  const company = await Company.findById(user.companyRef);

  if (!company || !company.externalId) {
    throw new Error(
      "Failed to resolve permissions: Company not found or externalId missing.",
    );
  }

  const role = user.roles.startsWith("org")
    ? await workos.authorization.getOrganizationRole(
        company.externalId,
        user.roles,
      )
    : await workos.authorization.getEnvironmentRole(user.roles);

  return role.permissions;
}

export async function generateAuthTokens(
  data: { user: IUser; loginMethod?: LOGIN_METHOD; company?: ICompany },
  options?: {
    exp?: SignOptions["expiresIn"];
  },
) {
  const { user, loginMethod } = data;

  const permissions = await resolveUserPermissions(user);

  const token = jwtHelper.generateToken(
    {
      _id: user._id.toString(),
      email: user.email,
      orgId: user.companyRef?.toString(),
      permissions,
      loginMethod,
    },
    options?.exp,
  );

  const refreshToken = await generateAndSaveRefreshToken(
    user._id,
    undefined,
    loginMethod,
  );

  return { token, refreshToken, permissions };
}

/**
 * Revoke a refresh token by deleting it from the database
 * @param token The refresh token string
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  await RefreshToken.deleteOne({ token });
}
