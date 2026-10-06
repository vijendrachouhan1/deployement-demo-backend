import { Request, Response, NextFunction } from "express";
import status from "http-status";
import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { handleMessage } from "@/webhooks/getstream/getstream.helper";
import { GetStreamEvent } from "@/types/getstream.types";

export class GetStreamWebhook {
  public async handleWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const body: GetStreamEvent = req.body;
      const { type, message, members, channel_id } = body;

      if (type !== "message.new") {
        return SuccessResponse(res, status.OK, {
          message: "Webhook ignored (not message.new)",
        });
      }

      if (!message || !members) {
        return ErrorResponse(res, status.BAD_REQUEST, {
          message: "Invalid webhook payload",
        });
      }

      const result = await handleMessage(message, members, channel_id);

      return SuccessResponse(res, status.OK, {
        message: "Webhook handled successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
