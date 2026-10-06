import { Middleware } from "@/middleware/auth";
import { ProductController } from "@/modules/products/product.controller";
import { ProductsAdminController } from "@/modules/products/product-admin.controller";
import { ProductSuperAdminController } from "@/modules/products/product-super-admin.controller";
import { productValidators } from "@/modules/products/utils/product.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class ProductsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new ProductController();

    this.router.get(
      "/",
      authorize(PERMISSIONS.PRODUCTS_VIEW),
      productValidators.getProducts,
      controller.get,
    );
    this.router.get(
      "/:id",
      authorize(PERMISSIONS.PRODUCTS_VIEW),
      productValidators.getProductById,
      controller.getOne,
    );
  }
}

export class AdminProductsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new ProductsAdminController();

    this.router.post(
      "/",
      authorize(PERMISSIONS.PRODUCTS_WRITE),
      productValidators.createProduct,
      adminController.create,
    );
    this.router.put(
      "/:id",
      authorize(PERMISSIONS.PRODUCTS_WRITE),
      productValidators.updateProduct,
      adminController.update,
    );
    this.router.delete(
      "/:id",
      authorize(PERMISSIONS.PRODUCTS_MANAGE),
      productValidators.deleteProduct,
      adminController.delete,
    );
  }
}

export class SuperAdminProductsRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const superAdminController = new ProductSuperAdminController();

    this.router
      .get("/", productValidators.getProducts, superAdminController.get)
      .post("/", productValidators.createProduct, superAdminController.create);
    this.router
      .get(
        "/:id",
        productValidators.getProductById,
        superAdminController.getOne,
      )
      .put(
        "/:id",
        productValidators.updateProduct,
        authorize(PERMISSIONS.PRODUCTS_WRITE),
        superAdminController.update,
      )
      .delete(
        "/:id",
        productValidators.deleteProduct,
        authorize(PERMISSIONS.PRODUCTS_MANAGE),
        superAdminController.delete,
      );
  }
}
