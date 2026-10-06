import { ReferralReward } from "@/db/models/referral-reward";
import { Referrals } from "@/db/models/referrals";
import { User } from "@/db/models/user";
import { REFERRAL_TYPE, USER_TYPE } from "@/enums";
import { REFERRAL_CONFIG } from "@/modules/auth/utils/auth.constant";
import {
  fillTimeSeries,
  getChartDateRange,
  getSortOptions,
  getTimeGrouping,
} from "@/modules/referrals/helpers/chart-data.helper";
import { REFERRAL_MESSAGES } from "@/modules/referrals/utils/referrals.constant";
import {
  DURATION,
  REFERRAL_REWARD_TRIGGER,
  REFERRAL_ROLE,
  REFERRAL_STATUS,
  REWARD_STATUS,
  REWARD_TYPE,
} from "@/modules/referrals/utils/referrals.enum";
import { TFindAllReferralsParams } from "@/modules/referrals/utils/referrals.types";
import { TObjectId } from "@/types";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import { ClientSession } from "mongoose";

class ReferralsHelper {
  async findAll({
    userRef,
    userRole,
    page,
    limit,
    skips,
    filters,
    sorting,
    searchValue,
  }: TFindAllReferralsParams) {
    return Referrals.aggregate([
      {
        $match: {
          ...(userRole === USER_TYPE.USER && {
            referredByRef: ObjectId(userRef),
          }),
          ...(filters?.status ? { status: filters.status } : {}),
        },
      },
      // Include referrer details for Super Admin
      ...(userRole === USER_TYPE.SUPER_ADMIN
        ? [
            {
              $lookup: {
                from: "users",
                let: { referrerId: "$referredByRef" },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ["$_id", "$$referrerId"] },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      email: 1,
                      "name.first": 1,
                      "name.last": 1,
                    },
                  },
                ],
                as: "referrer",
              },
            },
            { $unwind: "$referrer" },
            {
              $addFields: {
                referrerName: {
                  $concat: ["$referrer.name.first", " ", "$referrer.name.last"],
                },
              },
            },
          ]
        : []),
      {
        $lookup: {
          from: "users",
          let: { refereeId: "$referredToRef" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$refereeId"] },
              },
            },
            {
              $project: {
                _id: 1,
                email: 1,
                "name.first": 1,
                "name.last": 1,
                status: 1,
              },
            },
          ],
          as: "referee",
        },
      },
      { $unwind: "$referee" },

      {
        $addFields: {
          refereeName: {
            $concat: ["$referee.name.first", " ", "$referee.name.last"],
          },
          refereeEmail: "$referee.email",
        },
      },
      ...(searchValue?.length
        ? [
            {
              $match: {
                $or: [
                  { refereeName: { $regex: searchValue, $options: "i" } },
                  { refereeEmail: { $regex: searchValue, $options: "i" } },
                  ...(userRole === USER_TYPE.SUPER_ADMIN
                    ? [{ referrerName: { $regex: searchValue, $options: "i" } }]
                    : []),
                ],
              },
            },
          ]
        : []),

      {
        $lookup: {
          from: "referral_rewards",
          let: { referralId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$referralRef", "$$referralId"] },
                    ...(userRole !== USER_TYPE.SUPER_ADMIN
                      ? [{ $eq: ["$userRef", userRef] }]
                      : []),
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                rewardType: 1,
                rewardValue: 1,
                status: 1,
                role: 1,
                createdAt: 1,
              },
            },
          ],
          as: "referralReward",
        },
      },
      { $unwind: "$referralReward" },
      ...(filters?.rewardStatus
        ? [
            {
              $match: {
                "referralReward.status": filters.rewardStatus,
              },
            },
          ]
        : []),

      {
        $sort:
          sorting && Object.keys(sorting).length ? sorting : { createdAt: -1 },
      },

      ...createFacetPipeline(page, skips, limit),
    ]);
  }

  /**
   * Apply a referral code for a user
   */
  /**
   * `session` joins the caller's transaction — registration applies a referral
   * alongside the user and company writes, and a failure anywhere in that set
   * has to take the referral records with it.
   */
  async applyReferralCode(
    userRef: TObjectId,
    referralCode: string,
    session?: ClientSession,
  ) {
    const referrer = await User.findOne({
      referralCode,
    }).session(session ?? null);

    if (!referrer) {
      throw new Error(REFERRAL_MESSAGES.INVALID_CODE);
    }

    const existingReferral = await Referrals.findOne({
      referredByRef: referrer._id,
      referredToRef: userRef,
    }).session(session ?? null);

    if (existingReferral) {
      throw new Error(REFERRAL_MESSAGES.CODE_ALREADY_APPLIED);
    }

    const [referral] = await Referrals.create(
      [
        {
          referredByRef: referrer._id,
          referredToRef: userRef,
          type: REFERRAL_TYPE.SIGN_UP,
          status: REFERRAL_STATUS.QUALIFIED,
        },
      ],
      { session },
    );

    await ReferralReward.create(
      [
        {
          userRef: referrer._id,
          referralRef: referral._id,
          rewardValue: REFERRAL_CONFIG.SIGNUP_POINTS,
          rewardType: REWARD_TYPE.POINTS,
          status: REWARD_STATUS.EARNED,
          role: REFERRAL_ROLE.REFERER,
          trigger: REFERRAL_REWARD_TRIGGER.SIGN_UP,
        },
        {
          userRef: userRef,
          referralRef: referral._id,
          rewardValue: REFERRAL_CONFIG.REFEREE_SIGNUP_POINTS,
          rewardType: REWARD_TYPE.POINTS,
          status: REWARD_STATUS.EARNED,
          role: REFERRAL_ROLE.REFEREE,
          trigger: REFERRAL_REWARD_TRIGGER.SIGN_UP,
        },
      ],
      { session },
    );

    return User.updateOne(
      { _id: ObjectId(userRef) },
      { referredBy: referrer._id },
      { session },
    ).exec();
  }

  /**
   * Referral metrics
   */
  async getReferralMetrics({
    startDate,
    endDate,
  }: {
    startDate: string;
    endDate: string;
  }) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    return Referrals.aggregate([
      {
        $match: {
          createdAt: {
            $gte: start,
            $lte: end,
          },
        },
      },

      // ---- Join rewards
      {
        $lookup: {
          from: "referral_rewards",
          localField: "_id",
          foreignField: "referralRef",
          as: "reward",
        },
      },
      { $unwind: "$reward" },

      {
        $facet: {
          // otal referrals
          totalReferrals: [{ $count: "count" }],

          // Successful referrals
          successfulReferrals: [
            { $match: { status: REFERRAL_STATUS.QUALIFIED } },
            { $count: "count" },
          ],

          // Total rewards issued
          totalRewardsIssued: [
            { $match: { "reward.status": REWARD_STATUS.REDEEMED } },
            {
              $group: {
                _id: null,
                total: { $sum: "$reward.rewardValue" },
              },
            },
          ],
        },
      },

      // ---- Final shape
      {
        $project: {
          totalReferrals: {
            $ifNull: [{ $arrayElemAt: ["$totalReferrals.count", 0] }, 0],
          },
          successfulReferrals: {
            $ifNull: [{ $arrayElemAt: ["$successfulReferrals.count", 0] }, 0],
          },
          totalRewardsIssued: {
            $ifNull: [{ $arrayElemAt: ["$totalRewardsIssued.total", 0] }, 0],
          },
        },
      },

      // ---- Conversion rate
      {
        $addFields: {
          conversionRate: {
            $cond: [
              { $eq: ["$totalReferrals", 0] },
              0,
              {
                $multiply: [
                  {
                    $divide: ["$successfulReferrals", "$totalReferrals"],
                  },
                  100,
                ],
              },
            ],
          },
        },
      },
    ]);
  }

  async getActivityChart(timeframe: DURATION) {
    const { startDate, endDate } = getChartDateRange(timeframe);

    const groupBy = getTimeGrouping(timeframe);

    const result = await Referrals.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startDate.toDate(),
            $lte: endDate.toDate(),
          },
        },
      },

      {
        $group: {
          _id: groupBy,
          value: { $sum: 1 },
        },
      },

      {
        $project: {
          _id: 1,
          value: 1,
        },
      },

      { $sort: getSortOptions(timeframe) },
    ]);

    return fillTimeSeries(startDate, timeframe, result);
  }

  async getRewardsIssuedChart(timeframe: DURATION) {
    const { startDate, endDate } = getChartDateRange(timeframe);

    const groupBy = getTimeGrouping(timeframe);

    const result = await ReferralReward.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startDate.toDate(),
            $lte: endDate.toDate(),
          },
          status: REWARD_STATUS.REDEEMED,
        },
      },

      {
        $group: {
          _id: groupBy,
          value: { $sum: "$rewardValue" },
        },
      },

      {
        $project: {
          _id: 1,
          value: 1,
        },
      },

      { $sort: getSortOptions(timeframe) },
    ]);

    return fillTimeSeries(startDate, timeframe, result);
  }

  async redeemReward(referralRewardId: string) {
    const reward = await ReferralReward.findById(referralRewardId);

    if (!reward) {
      throw new Error("Referral reward not found.");
    }

    if (reward.status === REWARD_STATUS.REDEEMED) {
      throw new Error("Referral reward already redeemed.");
    }

    reward.status = REWARD_STATUS.REDEEMED;
    await reward.save();

    return reward;
  }
}

export const referralsHelper = new ReferralsHelper();
