import { Router } from "express";
import { FileUploadController } from "@/modules/file-upload/file-upload.controller";

export class FileUploadRouter {
  router: Router;
  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  initializeRoutes() {
    const controller = new FileUploadController();

    this.router.post("/presigned-url", controller.getPreSignedUrl);
  }
}
