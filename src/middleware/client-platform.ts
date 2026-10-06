import { isMobileRequest } from "@/helpers/common";
import { NextFunction, Response, Request } from "express";

export const requestClientPlatform = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.isMobile = isMobileRequest(req);
  next();
};
