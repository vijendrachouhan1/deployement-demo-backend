import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";
import { DURATION } from "./referrals.enum";

// ==================== Schemas ====================

export const GetAllReferralsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  rewardStatus: z.string().optional(),
  status: z.string().optional(),
});

// ==================== Validation Schemas ====================

export const GetAllReferralsValidationSchema = {
  query: GetAllReferralsQuerySchema,
} as const;

// ==================== Validators ====================

const getAllReferralsValidator = validate(
  GetAllReferralsValidationSchema,
  validationErrorHandler,
);

const applyReferralValidator = validate(
  {
    body: z.object({
      referralCode: z.string().min(1, "Referral code is required"),
    }),
  },
  validationErrorHandler,
);

const getReferralMetricsValidator = validate(
  {
    query: z.object({
      startDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid start date",
      }),
      endDate: z.string().refine((date) => !isNaN(Date.parse(date)), {
        message: "Invalid end date",
      }),
    }),
  },
  validationErrorHandler,
);

const getActivityChartValidator = validate(
  {
    query: z.object({
      timeframe: z.enum(DURATION),
    }),
  },
  validationErrorHandler,
);
const getRewardsIssuedChartValidator = validate(
  {
    query: z.object({
      timeframe: z.enum(DURATION),
    }),
  },
  validationErrorHandler,
);

const redeemReferralValidator = validate(
  {
    params: z.object({
      id: z.string().min(1, "Referral ID is required"),
    }),
  },
  validationErrorHandler,
);

const sendReferralInviteValidator = validate(
  {
    body: z.object({
      email: z.email("Invalid email address"),
    }),
  },
  validationErrorHandler,
);

// ==================== Super Admin Schemas ====================

const GetAllReferralsSuperAdminQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  searchValue: z.string().optional(),
});

// ==================== Super Admin Validation Schemas ====================

const GetAllReferralsSuperAdminValidationSchema = {
  query: GetAllReferralsSuperAdminQuerySchema,
} as const;

// ==================== Super Admin Validators ====================

const getAllReferralsSuperAdminValidator = validate(
  GetAllReferralsSuperAdminValidationSchema,
  validationErrorHandler,
);

export const referralValidators = {
  getAllReferrals: getAllReferralsValidator,
  applyReferral: applyReferralValidator,
  getReferralMetrics: getReferralMetricsValidator,
  getActivityChart: getActivityChartValidator,
  getRewardsIssuedChart: getRewardsIssuedChartValidator,
  redeemReferral: redeemReferralValidator,
  sendReferralInvite: sendReferralInviteValidator,
  getAllReferralsSuperAdmin: getAllReferralsSuperAdminValidator,
};
