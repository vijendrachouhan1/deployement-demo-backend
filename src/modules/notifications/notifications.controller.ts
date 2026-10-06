import { notificationsHelper } from "@/modules/notifications/helpers/notifications.helper";
import { NOTIFICATION_MESSAGES } from "@/modules/notifications/utils/notifications.constant";
import { TNotificationsController } from "@/modules/notifications/utils/notifications.types";
import { SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { PaginatedSearchQuery } from "@/types/query.types";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";

/**
 * NotificationsController class for handling notification-related HTTP requests
 */
export class NotificationsController {
  /**
   * Get all notifications for the authenticated user
   */
  get: TNotificationsController["getNotifications"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;

      const query: PaginatedSearchQuery = req.query;
      const data = await notificationsHelper.findAll(
        {
          userRef,
        },
        {
          page: Number(query.page ?? 1),
          pageSize: Number(query.pageSize ?? 50),
        },
      );
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.DATA_RETRIEVED,
        data,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Create a new notification
   */
  create: TNotificationsController["createNotification"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const { message, title } = req.body;
      const user = req.user!;
      const userRef = user._id;
      const companyRef = user.companyRef!.toString();

      await notificationsHelper.create({
        userRef,
        companyRef: ObjectId(companyRef),
        message,
        title,
      });
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.SUCCESS,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Get a single notification by user reference
   */
  getOne: TNotificationsController["paramId"] = async (req, res, next) => {
    try {
      const userRef = req.params.id;

      const data = await notificationsHelper.findOne({
        userRef,
      });
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.DATA_RETRIEVED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update a notification
   */
  update: TNotificationsController["updateNotification"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const id = req.params.id;
      const { update } = req.body;

      const data = await notificationsHelper.findAndUpdate({
        id,
        update,
      });

      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.DATA_UPDATED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Delete a notification
   */
  delete: TNotificationsController["paramId"] = async (req, res, next) => {
    try {
      const notificationId = req.params.id;
      const userRef = req.user!._id;

      const data = await notificationsHelper.delete(notificationId, userRef);

      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.NOTIFICATION_DELETED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Clear all notifications for the authenticated user
   */
  clearAllNotifications = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userRef = req.user!._id;

      const data = await notificationsHelper.clearNotifications(userRef);

      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.NOTIFICATION_CLEARED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get unread notification count
   */
  getUnreadCount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userRef = req.user!._id;

      const data = await notificationsHelper.getUnreadCount(userRef);

      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.DATA_RETRIEVED,
        data: {
          count: data,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Mark all notifications as read
   */
  markAllAsRead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userRef = req.user!._id;

      const data = await notificationsHelper.markAllAsRead({
        userRef,
        isOpened: false,
      });
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.NOTIFICATION_MARKED_READ,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Mark a single notification as read
   */
  markAsRead: TNotificationsController["paramId"] = async (req, res, next) => {
    try {
      const id = req.params.id;

      const data = await notificationsHelper.findAndUpdate({
        id,
        update: { isOpened: true },
      });
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.NOTIFICATION_MARKED_READ,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Get notification preferences for the authenticated user
   */
  getPreference = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userRef = req.user!._id;

      const data = await notificationsHelper.getPreferences(userRef);

      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.PREFERENCES_FETCHED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Update notification preferences
   */
  updatePreference: TNotificationsController["updatePreference"] = async (
    req,
    res,
    next,
  ) => {
    try {
      const userRef = req.user!._id;
      const { type, channels } = req.body;

      const data = await notificationsHelper.updatePreference(
        userRef,
        type,
        channels,
      );
      return SuccessResponse(res, httpStatus.OK, {
        message: NOTIFICATION_MESSAGES.PREFERENCES_UPDATED,
        data,
      });
    } catch (error) {
      next(error);
    }
  };
}
