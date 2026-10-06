import { Router } from "express";
import { ErrorLogsRouter } from "@/modules/error-logs";

export class SystemRouter {
  router: Router;
  constructor() {
    this.router = Router();
    this.router.use("/error-logs", new ErrorLogsRouter().router);
  }
}
