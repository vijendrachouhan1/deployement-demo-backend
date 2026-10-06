import envConfig from "@/config/env";
import { Company } from "@/db/models/company";
import { User } from "@/db/models/user";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { ObjectId } from "@/helpers/common";
import { workos } from "@/providers/auth/authkit.provider";
import { NextFunction, Request, Response } from "express";
import status from "http-status";

export class AuthkitWebhook {
  public handleWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const sigHeader = req.headers["workos-signature"] as string;

      if (!sigHeader) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Missing AuthKit signature header.",
        });
      }

      let event: Awaited<ReturnType<typeof workos.webhooks.constructEvent>>;

      try {
        event = await workos.webhooks.constructEvent({
          payload: req.body,
          sigHeader,
          secret: envConfig.WORKOS_WEBHOOK_SECRET,
        });
      } catch (err) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Webhook signature verification failed.",
          errors: err,
        });
      }

      switch (event.event) {
        case "user.created": {
          /**
           * Sync the newly created auth-provider user into our local DB.
           * This acts as a fallback for cases where the user was created
           * directly in the WorkOS dashboard or via another integration,
           * bypassing our normal registration flow.
           */
          const providerUser = event.data;
          const existing = await User.findOne({
            externalUserId: providerUser.id,
          });

          if (!existing) {
            const company = await Company.create({
              name: providerUser.email,
            });

            const user = await User.create({
              email: providerUser.email,
              externalUserId: providerUser.id,
              name: {
                first: providerUser.firstName ?? "",
                last: providerUser.lastName ?? "",
              },
              companyRef: company._id,
            });

            await Company.findByIdAndUpdate(company._id, {
              userRef: user._id,
            });
          }
          break;
        }

        case "user.updated": {
          /**
           * Keep local user profile in sync when the auth provider
           * updates user attributes (e.g. email change, name change).
           */
          const providerUser = event.data;
          await User.findOneAndUpdate(
            {
              ...(providerUser.externalId
                ? { _id: ObjectId(providerUser.externalId) }
                : { externalUserId: providerUser.id }),
            },
            {
              email: providerUser.email,
              name: {
                first: providerUser.firstName ?? "",
                last: providerUser.lastName ?? "",
              },
            },
          );
          break;
        }

        case "user.deleted": {
          /**
           * Soft-delete or hard-delete the local user when the auth
           * provider deletes them. Currently performs a hard delete;
           * swap for a status update if soft-delete is preferred.
           */
          const providerUser = event.data;
          await User.deleteOne({
            ...(providerUser.externalId
              ? { _id: ObjectId(providerUser.externalId) }
              : { externalUserId: providerUser.id }),
          });
          break;
        }

        default:
          // Unhandled event — acknowledge receipt without processing
          break;
      }

      return SuccessResponse(res, status.OK, {
        message: "Authkit webhook processed successfully.",
      });
    } catch (error) {
      next(error);
    }
  };
}
