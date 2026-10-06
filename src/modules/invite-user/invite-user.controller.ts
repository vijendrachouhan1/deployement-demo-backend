import { InvitedUsers } from "@/db/models/invitedUsers";
import { inviteUserHelper } from "@/modules/invite-user/helpers/invite-user.helper";
import {
  INVITE_BATCH_SIZE,
  INVITE_USER_ERROR_MESSAGES,
  INVITE_USER_SUCCESS_MESSAGES,
} from "@/modules/invite-user/utils/invite-user.constant";
import { TInviteUserController } from "@/modules/invite-user/utils/invite-user.types";
import { INVITED_USER_STATUS, USER_TYPE } from "@/enums";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { parseQueryString } from "@/helpers/query";
import { extractLimitAndOffset } from "@/helpers/pagination";
import status from "http-status";

/**
 * InviteUserController class for handling invite user-related HTTP requests
 */
export class InviteUserController {
  /**
   * Invite multiple users
   */
  inviteMultipleUsers: TInviteUserController["inviteMultipleUsers"] = async (
    req,
    res,
  ) => {
    try {
      const { users } = req.body;
      const user = req.user!;

      if (!user?.companyRef) {
        return ErrorResponse(res, status.UNPROCESSABLE_ENTITY, {
          message: INVITE_USER_ERROR_MESSAGES.COMPANY_REF_NOT_FOUND,
        });
      }

      const role =
        user.roles === USER_TYPE.SUPER_ADMIN && !user.companyRef
          ? USER_TYPE.ADMIN
          : USER_TYPE.USER;

      // Step 1: Save invites (already invited ones with status ALREADY_INVITED, new with status QUEUED)
      await inviteUserHelper.filterAndSaveBulkInvites({
        users,
        companyRef: user?.companyRef._id,
        userRef: user._id,
        role,
      });

      // Step 2: Fetch all newly QUEUED invites for this company and user
      const queuedInvites = await InvitedUsers.find({
        companyRef: user?.companyRef._id,
        status: INVITED_USER_STATUS.QUEUED,
      });

      let totalSuccess = 0;
      let totalFailed = 0;

      for (let i = 0; i < queuedInvites.length; i += INVITE_BATCH_SIZE) {
        const batch = queuedInvites.slice(i, i + INVITE_BATCH_SIZE);

        const invitePromises = batch.map(async (entry) => {
          try {
            await inviteUserHelper.inviteUsers(entry.invitedEmail);

            // On success, update status to INVITED
            await InvitedUsers.updateOne(
              { _id: entry._id },
              { $set: { status: INVITED_USER_STATUS.PENDING, error: null } },
            );

            totalSuccess++;
          } catch (error) {
            // On failure, update status to FAILED with error message
            let message = "";
            if (error instanceof Error) {
              message = error.message;
            }

            await InvitedUsers.updateOne(
              { _id: entry._id },
              {
                $set: {
                  status: INVITED_USER_STATUS.FAILED,
                  error: message || INVITE_USER_ERROR_MESSAGES.UNKNOWN_ERROR,
                },
              },
            );

            totalFailed++;
          }
        });

        await Promise.all(invitePromises);
      }

      return SuccessResponse(res, status.OK, {
        message: `Processed ${queuedInvites.length} invites: ${totalSuccess} succeeded, ${totalFailed} failed.`,
        data: {
          totalQueued: queuedInvites.length,
          successful: totalSuccess,
          failed: totalFailed,
        },
      });
    } catch (error) {
      let message = "";
      if (error instanceof Error) {
        message = error.message;
      }
      return ErrorResponse(res, status.INTERNAL_SERVER_ERROR, {
        message: message || INVITE_USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      });
    }
  };

  /**
   * Resend invitation to a user
   */
  resendInvites: TInviteUserController["resendInvites"] = async (req, res) => {
    try {
      const { email } = req.body;
      const user = req.user!;

      if (!user?.companyRef) {
        return ErrorResponse(res, status.UNPROCESSABLE_ENTITY, {
          message: INVITE_USER_ERROR_MESSAGES.COMPANY_REF_NOT_FOUND,
        });
      }

      const data = await inviteUserHelper.resendInvitation({
        email,
        companyRef: user?.companyRef._id,
      });
      return SuccessResponse(res, status.OK, {
        message: INVITE_USER_SUCCESS_MESSAGES.INVITE_RESENT,
        data,
      });
    } catch (error) {
      let message = "";
      if (error instanceof Error) {
        message = error.message;
      }
      return ErrorResponse(res, status.CONFLICT, {
        message: message || INVITE_USER_ERROR_MESSAGES.UNKNOWN_ERROR,
      });
    }
  };

  /**
   * Cancel an invitation
   */
  cancelInvite: TInviteUserController["cancelInvite"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user!;

    try {
      const inviteId = req.params.id;
      const companyRef = user.companyRef!;
      const data = await inviteUserHelper.cancelInvite(
        inviteId,
        companyRef.toString(),
      );
      return SuccessResponse(res, status.OK, {
        message: INVITE_USER_SUCCESS_MESSAGES.SUCCESS,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Soft delete a user
   */
  softdeleteUsers: TInviteUserController["softDeleteUsers"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const { Status, companyRef } = req.body;

      await inviteUserHelper.deleteUser(id, Status, companyRef);
      return SuccessResponse(res, status.OK, {
        success: true,
        message: INVITE_USER_SUCCESS_MESSAGES.USER_DELETED,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get invited users with pagination and filtering
   */
  getInvitedUsers: TInviteUserController["getInvitedUsers"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const user = req.user!;
      const companyRef = user.companyRef!;

      const query = req.query as Record<string, string>;
      const { page, pageSize, skips } = extractLimitAndOffset(
        query.page,
        query.pageSize,
      );
      const { filters, sorting } = parseQueryString(query);

      const invitedUsers = await inviteUserHelper.findUsers({
        companyRef,
        filters,
        sorting,
        page,
        pageSize,
        skips,
        searchValue: query.search as string,
      });

      return SuccessResponse(res, status.OK, {
        message: INVITE_USER_SUCCESS_MESSAGES.INVITED_USERS_DATA,
        data: invitedUsers,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get users who have accepted the invitation
   */
  getUsersWithAcceptedInvitation: TInviteUserController["getUsersWithAcceptedInvitation"] =
    async (req, res, next) => {
      const user = req.user!;

      try {
        const companyRef = user.companyRef!;

        const query = req.query as Record<string, string>;

        const { page, pageSize, skips } = extractLimitAndOffset(
          query.page,
          query.pageSize,
        );

        const { filters, sorting } = parseQueryString(query);

        const invitedUsers = await inviteUserHelper.findTeamMembers({
          skips,
          pageSize,
          page,
          filters,
          searchValue: query.search as string,
          sorting,
          companyRef: ObjectId(companyRef),
        });

        return SuccessResponse(res, status.OK, {
          message: INVITE_USER_SUCCESS_MESSAGES.INVITED_USERS_DATA,
          data: invitedUsers,
        });
      } catch (error: any) {
        next(error);
      }
    };

  /**
   * Get count of users by status
   */
  getUsersCount: TInviteUserController["getUsersCount"] = async (
    req,
    res,
    next,
  ) => {
    const user = req.user!;

    try {
      const companyRef = user.companyRef!;
      const count = await inviteUserHelper.countUsers(companyRef);
      return SuccessResponse(res, status.OK, {
        message: INVITE_USER_SUCCESS_MESSAGES.INVITED_USERS_DATA,
        data: count,
      });
    } catch (error) {
      next(error);
    }
  };
}
