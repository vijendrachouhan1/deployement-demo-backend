import envConfig from "@/config/env";
import { SuccessResponse } from "@/helpers/api-response";
import {
  buildPaginatedResponse,
  extractLimitAndOffset,
} from "@/helpers/pagination";
import {
  getMongoFilter,
  getMongoSort,
  parseQueryString,
} from "@/helpers/query";
import { referralsHelper } from "@/modules/referrals/helpers/referrals.helper";
import { REFERRAL_MESSAGES } from "@/modules/referrals/utils/referrals.constant";
import { TReferralController } from "@/modules/referrals/utils/referrals.types";
import { emailService } from "@/providers/email";
import status from "http-status";

/**
 * ReferralsController class for handling referral-related HTTP requests
 */
export class ReferralsController {
  /**
   * Get all referrals with pagination
   */
  getAllReferrals: TReferralController["getAllReferrals"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const query = req.query;

      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );
      const { filters, sorting } = parseQueryString(
        query as Record<string, string>,
      );
      const mongoFilter = getMongoFilter({ filters });
      const mongoSort = getMongoSort(sorting);

      const data = await referralsHelper.findAll({
        userRole: user.roles,
        userRef: user._id,
        filters: mongoFilter,
        sorting: mongoSort,
        page,
        limit: pageSize,
        skips,
        searchValue: query.search,
      });

      const result = data[0];

      return SuccessResponse(res, status.OK, {
        message: REFERRAL_MESSAGES.SUCCESS,
        data: buildPaginatedResponse(result.items, {
          page,
          pageSize,
          totalCount: result.total,
        }),
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Apply a referral code
   */
  applyReferral: TReferralController["applyReferral"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const { referralCode } = req.body;

      const data = await referralsHelper.applyReferralCode(
        user._id,
        referralCode,
      );

      return SuccessResponse(res, status.OK, {
        message: REFERRAL_MESSAGES.CODE_APPLIED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Redeem a reward
   */
  redeemReferral: TReferralController["redeemReferral"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const data = await referralsHelper.redeemReward(req.params.id);

      return SuccessResponse(res, status.OK, {
        message: REFERRAL_MESSAGES.REDEEM_SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Send a referral invite
   */
  sendReferralInvite: TReferralController["sendReferralInvite"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const { email } = req.body;

      await emailService.sendEmail({
        to: email,
        subject: `Referral Invite`,
        html: `Click <a href='${envConfig.FRONTEND_INVITE_URL}'>here</a> to join using referral code: ${user.referralCode}`,
      });

      return SuccessResponse(res, status.OK, {
        message: REFERRAL_MESSAGES.SUCCESS,
      });
    } catch (error) {
      next(error);
    }
  };
}
