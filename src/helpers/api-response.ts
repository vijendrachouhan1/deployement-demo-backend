import { type Response } from "express";

import { type IApiResponse } from "@/types/api-config.types";

export const SuccessResponse = (
  res: Response,
  statusCode: number,
  params: IApiResponse,
) => {
  return res.status(statusCode).json({
    success: true,
    message: params.message,
    data: params?.data !== undefined ? params.data : {},
    errors: params?.errors ?? {},
    messageCode: params?.messageCode || undefined,
  });
};

export const ErrorResponse = (
  res: Response,
  statusCode: number,
  params: IApiResponse,
) => {
  return res.status(statusCode).json({
    success: false,
    message: params.message,
    data: params?.data ?? {},
    errors: params?.errors ?? {},
    messageCode: params?.messageCode || undefined,
  });
};
