import { SuccessResponse } from "@/helpers/api-response";
import { referralsHelper } from "@/modules/referrals/helpers/referrals.helper";
import { TReferralController } from "@/modules/referrals/utils/referrals.types";
import status from "http-status";

export class SuperAdminReferralController {
  getReferralMetrics: TReferralController["getReferralMetrics"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { startDate, endDate } = req.query;

      const data = await referralsHelper.getReferralMetrics({
        startDate,
        endDate,
      });

      return SuccessResponse(res, status.OK, {
        message: "Referral metrics fetched successfully",
        data: data[0],
      });
    } catch (error) {
      next(error);
    }
  };

  getActivityChart: TReferralController["getActivityChart"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { timeframe } = req.query;

      const data = await referralsHelper.getActivityChart(timeframe);

      return SuccessResponse(res, status.OK, {
        message: "Referral activity chart fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  };
  getRewardsIssuedChart: TReferralController["getRewardsIssuedChart"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { timeframe } = req.query;

      const data = await referralsHelper.getRewardsIssuedChart(timeframe);

      return SuccessResponse(res, status.OK, {
        message: "Rewards issued chart fetched successfully",
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
