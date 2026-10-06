import { IUserDocument, User } from "@/db/models/user";
import { ObjectId } from "@/helpers/common";
import { createFacetPipeline } from "@/helpers/query";
import { PaginatedSearchQuery } from "@/types/query.types";
import {
  USER_ANALYTICS_DURATION,
  USER_ANALYTICS_TYPE,
} from "@/modules/users/utils/users.enum";
import dayjs from "dayjs";

import {
  evaluateUserAnalytics,
  evaluateUserDashboardStats,
  evaluateUserGrowthStats,
} from "@/modules/users/helpers/user-stats.helper";
import { extractLimitAndOffset } from "@/helpers/pagination";
import isoWeek from "dayjs/plugin/isoWeek.js";
import { FilterQuery } from "mongoose";
import { workos } from "@/providers/auth/authkit.provider";

dayjs.extend(isoWeek);

class UserHelper {
  public findAll = async (query: PaginatedSearchQuery) => {
    const searchValue = query.searchValue;
    const companyRef = query.companyRef;

    const { page, pageSize, skips } = extractLimitAndOffset(
      query.page,
      query.pageSize,
    );

    const facetPipeline = createFacetPipeline(page, skips, pageSize);

    return User.aggregate([
      {
        $match: {
          ...(companyRef ? { companyRef: ObjectId(companyRef) } : {}),
          ...(searchValue && searchValue.length
            ? {
                $text: { $search: searchValue },
              }
            : {}),
        },
      },
      ...facetPipeline,
    ]);
  };

  public findOne = async (id: string) => {
    return User.findById(id);
  };

  public updateStatus = async (
    id: string,
    companyRef: string,
    status: string,
  ) => {
    return User.findOneAndUpdate(
      { $and: [{ _id: id }, { companyRef }] },
      {
        $set: {
          status,
        },
      },
      { returnDocument: "after" },
    );
  };

  public changeUserRole = async (
    userId: string,
    companyRef: string,
    role: string,
  ) => {
    const user = await User.findOne({
      _id: ObjectId(userId),
      companyRef: ObjectId(companyRef),
    }).lean();

    if (!user) {
      return null;
    }

    await workos.userManagement.updateOrganizationMembership(
      user.organizationMembershipId!,
      {
        roleSlug: role,
      },
    );

    return User.updateOne({ _id: userId, companyRef }, { roles: role });
  };

  public updateUser = async (
    condition: FilterQuery<IUserDocument>,
    data: Partial<IUserDocument>,
  ) => {
    return User.findOneAndUpdate(condition, { $set: data }, { new: true });
  };

  public updateMany = async (
    condition: FilterQuery<IUserDocument>,
    data: Partial<IUserDocument>,
  ) => {
    return User.updateMany(condition, { $set: data });
  };

  public getUserGrowth = async (
    filter: object = {},
    includeNewUsers: boolean,
  ) => {
    return evaluateUserGrowthStats(filter, includeNewUsers);
  };

  async getUserAnalytics(
    type: USER_ANALYTICS_TYPE,
    duration: USER_ANALYTICS_DURATION,
    year?: number,
  ) {
    return evaluateUserAnalytics(type, duration, year);
  }

  async getDashboardStats(companyRef: string) {
    return evaluateUserDashboardStats(companyRef);
  }
}

export const userHelper = new UserHelper();
