import { SOCIAL_OAUTH_METHOD } from "@/enums/auth.enum";

/** The raw 4-digit code every seeded OTP carries unless a test overrides it. */
export const DEFAULT_TEST_OTP = "1234";

/**
 * A fully-enrolled authenticator-app MFA state. The factor id matches what the
 * mocked enrollAuthFactor returns ("auth_factor_test"), so challenge assertions
 * can compare against ENROLLED_MFA.factorId directly.
 */
export const ENROLLED_MFA = {
  enrolled: true,
  enabled: true,
  factorId: "auth_factor_test",
  factorIds: ["auth_factor_test"],
};

/** OAuth provider used across the social-signup tests. */
export const VALID_OAUTH_PROVIDER = SOCIAL_OAUTH_METHOD.GOOGLE;
