import { Middleware } from "@/middleware/auth";
import { CompanyAdminController } from "@/modules/company/company-admin.controller";
import { CompanySuperAdminController } from "@/modules/company/company-super-admin.controller";
import { companyValidators } from "@/modules/company/utils/company.validation";
import { Router } from "express";

const middleware = new Middleware();

export class AdminCompanyRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new CompanyAdminController();

    this.router.put(
      "/:id",
      companyValidators.updateCompany,
      adminController.updateCompany,
    );
  }
}

export class SuperAdminCompanyRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const superAdminController = new CompanySuperAdminController();

    this.router.get(
      "/",
      companyValidators.getCompanies,
      superAdminController.getCompanies,
    );
    this.router
      .get(
        "/:id",
        companyValidators.getCompanyDetails,
        superAdminController.getCompanyDetails,
      )
      .put(
        "/:id",
        companyValidators.editCompany,
        superAdminController.editCompany,
      );
    this.router.get(
      "/users/:id",
      companyValidators.getCompanyUsers,
      superAdminController.getCompanyUsers,
    );
    this.router.put(
      "/change-user-role/:id",
      companyValidators.changeUserRole,
      superAdminController.changeUserRole,
    );
  }
}
