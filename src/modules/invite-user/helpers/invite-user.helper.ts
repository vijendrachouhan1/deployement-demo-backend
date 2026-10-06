import envConfig from "@/config/env";
import { InvitedUsers } from "@/db/models/invitedUsers";
import { User } from "@/db/models/user";
import { INVITED_USER_STATUS, STATUS } from "@/enums";
import { JWT_CONFIG, jwtHelper } from "@/helpers/jwt";
import { buildPaginatedResponse } from "@/helpers/pagination";
import {
  createFacetPipeline,
  getMongoFilter,
  getMongoSort,
} from "@/helpers/query";
import { INVITE_USER_ERROR_MESSAGES } from "@/modules/invite-user/utils/invite-user.constant";
import {
  IFilterAndSaveBulkInvites,
  IFindTeamMembersParams,
  IFindUsersParams,
  IResendInvitation,
} from "@/modules/invite-user/utils/invite-user.types";
import { emailService } from "@/providers/email";
import { TObjectId } from "@/types";
import { PipelineStage } from "mongoose";

/**
 * InviteUserHelper class for handling invite user database operations
 */
class InviteUserHelper {
  private sendInviteEmail = async (email: string, link: string) => {
    return emailService.sendEmail({
      to: email,
      subject: `${email} Welcome`,
      html: `
          <p>Hey ${email},</p>
          <p>You've been invited to sign up on Byldd's boilerplate.</p>
          <p>Please click <a href="${link}"">here</a></p>
          `,
    });
  };

  /**
   * Cancel an invitation
   */
  async cancelInvite(inviteId: string, companyRef: string) {
    const existingInvitation = await InvitedUsers.findOneAndUpdate(
      { _id: inviteId, companyRef },
      { status: INVITED_USER_STATUS.CANCELED },
    );

    if (existingInvitation) {
      return {
        message: INVITE_USER_ERROR_MESSAGES.INVITATION_CANCELLED,
      };
    } else {
      throw new Error(INVITE_USER_ERROR_MESSAGES.INVALID_INVITE);
    }
  }

  /**
   * Resend invitation to a user
   */
  async resendInvitation({ email, companyRef }: IResendInvitation) {
    const user = await User.findOne({ email });

    if (user) {
      throw new Error(
        `User with ${user.email} ${INVITE_USER_ERROR_MESSAGES.USER_ALREADY_ACCEPTED}`,
      );
    }

    const existingInvitation = await InvitedUsers.findOneAndUpdate(
      {
        invitedEmail: email,
        companyRef,
      },
      { status: INVITED_USER_STATUS.PENDING },
    );

    if (!existingInvitation) {
      throw new Error(
        `${email} ${INVITE_USER_ERROR_MESSAGES.EMAIL_NOT_INVITED}`,
      );
    }

    const token = jwtHelper.generateToken(
      { email },
      JWT_CONFIG.INVITE_TOKEN_EXPIRY,
    );
    const link = `${envConfig.FRONTEND_INVITE_URL}/?inviteToken=${token}`;
    await this.sendInviteEmail(email, link);
    return {
      message: `Invitation email re-sent successfully to ${email}`,
    };
  }

  /**
   * Send invitation email to a user
   */
  async inviteUsers(email: string) {
    const token = jwtHelper.generateToken(
      { email },
      JWT_CONFIG.INVITE_TOKEN_EXPIRY,
    );
    const link = `${envConfig.FRONTEND_INVITE_URL}/?inviteToken=${token}`;

    await this.sendInviteEmail(email, link);

    return {
      message: "Invited mail sent successfully!",
    };
  }

  /**
   * Find invited users with pagination and filtering
   */
  async findUsers({
    companyRef,
    filters,
    sorting,
    searchValue,
    page,
    pageSize,
    skips,
  }: IFindUsersParams) {
    const mongoFilter = getMongoFilter({
      filters,
      searchValue,
      searchColumns: ["name.first", "name.last", "invitedEmail"],
    });
    const mongoSort = getMongoSort(sorting);

    const pipeline: PipelineStage[] = [
      { $match: { ...mongoFilter, companyRef, status: { $ne: "ACCEPTED" } } },
      ...(Object.keys(mongoSort).length
        ? [{ $sort: mongoSort }]
        : [{ $sort: { createdAt: -1 } as Record<string, 1 | -1> }]),
      ...createFacetPipeline(page, skips, pageSize),
    ];

    const result = await InvitedUsers.aggregate(pipeline);
    const data = result[0];

    return buildPaginatedResponse(data.items, {
      page: data.page,
      pageSize: data.pageSize,
      totalCount: data.total,
    });
  }

  /**
   * Find team members who have accepted the invitation
   */
  async findTeamMembers({
    companyRef,
    filters,
    sorting,
    searchValue,
    page,
    pageSize,
    skips,
  }: IFindTeamMembersParams) {
    const mongoFilter = getMongoFilter({
      filters,
      searchValue,
      searchColumns: ["name.first", "name.last", "email"],
    });
    const mongoSort = getMongoSort(sorting);

    const pipeline: PipelineStage[] = [
      {
        $match: { ...mongoFilter, companyRef },
      },
      ...(Object.keys(mongoSort).length
        ? [
            {
              $sort: mongoSort,
            },
          ]
        : []),
      ...createFacetPipeline(page, skips, pageSize),
    ];
    const result = await User.aggregate(pipeline);
    const data = result[0];

    return buildPaginatedResponse(data.items, {
      page: data.page,
      pageSize: data.pageSize,
      totalCount: data.total,
    });
  }

  /**
   * Filter and save bulk invites
   */
  async filterAndSaveBulkInvites({
    users,
    companyRef,
    userRef,
    role,
  }: IFilterAndSaveBulkInvites) {
    const emails = users.map((u) => u.email.toLowerCase());

    // Step 1: Get already invited emails for this company
    const existingInvites = await InvitedUsers.find({
      invitedEmail: { $in: emails },
      companyRef,
    });

    const existingEmailSet = new Set(
      existingInvites.map((u) => u.invitedEmail.toLowerCase()),
    );

    // Step 2: Prepare all invite documents
    const invitesToInsert = users.map((user) => {
      const email = user.email.toLowerCase();
      const alreadyInvited = existingEmailSet.has(email);

      return {
        invitedEmail: email,
        name: {
          first: user.firstName,
          last: user.lastName,
        },
        companyRef,
        userRef,
        role,
        status: alreadyInvited
          ? INVITED_USER_STATUS.ALREADY_INVITED
          : INVITED_USER_STATUS.QUEUED,
        errorMessages: alreadyInvited ? "Email already invited" : "",
        permissions: [
          {
            collectionName: "default",
            access: false,
            permission: "",
          },
        ],
      };
    });

    // Step 3: Insert all invite records
    if (invitesToInsert.length > 0) {
      await InvitedUsers.insertMany(invitesToInsert);
    }
  }

  /**
   * Soft delete a user
   */
  async deleteUser(id: string, status: string, companyRef: string) {
    return User.findOneAndUpdate(
      { $and: [{ _id: id }, { companyRef }] },
      {
        $set: {
          status,
        },
      },
      { returnDocument: "after" },
    );
  }

  /**
   * Count users by status
   */
  async countUsers(companyRef: TObjectId) {
    const [invited, result] = [
      await InvitedUsers.countDocuments({
        companyRef,
        status: { $ne: INVITED_USER_STATUS.ACCEPTED },
      }),
      await User.aggregate([
        {
          $match: { companyRef },
        },

        {
          $facet: {
            total: [{ $count: "count" }],
            active: [
              { $match: { status: STATUS.ACTIVE } },
              { $count: "count" },
            ],
            inActive: [
              { $match: { status: STATUS.INACTIVE } },
              { $count: "count" },
            ],
          },
        },
        {
          $project: {
            total: { $arrayElemAt: ["$total.count", 0] },
            active: { $arrayElemAt: ["$active.count", 0] },
            inActive: { $arrayElemAt: ["$inActive.count", 0] },
          },
        },
        {
          $addFields: {
            total: { $ifNull: ["$total", 0] },
            active: { $ifNull: ["$active", 0] },
            inActive: { $ifNull: ["$inActive", 0] },
          },
        },
      ]),
    ];

    return {
      ...result[0],
      invited,
    };
  }
}

export const inviteUserHelper = new InviteUserHelper();
