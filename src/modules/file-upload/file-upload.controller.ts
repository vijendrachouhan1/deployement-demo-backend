import { Request, Response, NextFunction } from "express";
import httpStatus from "http-status";

import { ErrorResponse, SuccessResponse } from "@/helpers/api-response";
import { fileStorageService } from "@/providers/file-storage";

export class FileUploadController {
  public getPreSignedUrl = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const query: { fileName: string; fileType: string } = req.body;
      const { fileName, fileType } = query;

      if (!fileName || !fileType) {
        return ErrorResponse(res, httpStatus.BAD_REQUEST, {
          message: "fileName and fileType are required.",
        });
      }

      const { url, keyFile } = await fileStorageService.getPreSignedUrl(
        fileName,
        fileType,
      );
      return SuccessResponse(res, httpStatus.OK, {
        message: "success.",
        data: { url, keyFile },
      });
    } catch (error) {
      next(error);
    }
  };
}
