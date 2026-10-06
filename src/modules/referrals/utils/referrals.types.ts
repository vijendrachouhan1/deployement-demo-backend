import { USER_TYPE } from "@/enums";
import { referralValidators } from "@/modules/referrals/utils/referrals.validation";
import { TObjectId } from "@/types";

// ==================== Controller Types ====================

export type TReferralController = typeof referralValidators;

// ==================== Helper Types ====================

export type TFindAllReferralsParams = {
  userRef: TObjectId;
  page: number;
  limit: number;
  skips: number;
  filters?: Record<string, any>;
  sorting?: Record<string, 1 | -1>;
  searchValue?: string;
  userRole: USER_TYPE;
};
