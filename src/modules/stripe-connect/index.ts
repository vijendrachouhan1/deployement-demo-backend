import { Middleware } from "@/middleware/auth";
import { StripeConnectController } from "@/modules/stripe-connect/stripe-connect.controller";
import { StripeConnectAdminController } from "@/modules/stripe-connect/stripe-connect-admin.controller";
import { StripeConnectSuperAdminController } from "@/modules/stripe-connect/stripe-connect-super-admin.controller";
import { stripeConnectValidators } from "@/modules/stripe-connect/utils/stripe-connect.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class StripeConnectRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new StripeConnectController();

    // `stripe connect customer` routes
    this.router.post(
      "/customer",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      controller.createCustomer,
    );
    this.router.get(
      "/customer",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      controller.getCustomer,
    );

    // `stripe connect products` routes
    this.router.get(
      "/product",
      authorize(PERMISSIONS.STRIPE_CONNECT_PRODUCTS_VIEW),
      stripeConnectValidators.product,
      controller.product,
    );

    // `stripe connect transaction` routes
    this.router.post(
      "/create-payment-intent",
      authorize(PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE),
      stripeConnectValidators.createPaymentIntent,
      controller.createPaymentIntent,
    );
    this.router.get(
      "/past-orders",
      authorize(PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE),
      stripeConnectValidators.pastOrders,
      controller.pastOrders,
    );
    this.router.get(
      "/past-orders/count",
      authorize(PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE),
      controller.pastOrdersCount,
    );
    this.router.post(
      "/refund/:id",
      authorize(PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE),
      stripeConnectValidators.refundOrder,
      controller.refundOrder,
    );
  }
}

export class AdminStripeConnectRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new StripeConnectAdminController();

    // `stripe connect vendor` routes
    this.router.get(
      "/vendor-details",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      stripeConnectValidators.vendorDetails,
      adminController.vendorDetails,
    );
    this.router.post(
      "/account",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      stripeConnectValidators.createAccount,
      adminController.createAccount,
    );
    this.router.post(
      "/account-session",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      stripeConnectValidators.createAccountSession,
      adminController.createAccountSession,
    );
    this.router.post(
      "/express-dashboard",
      authorize(PERMISSIONS.STRIPE_CONNECT_ONBOARDING),
      stripeConnectValidators.createDashboardLink,
      adminController.createDashboardLink,
    );
    this.router.get(
      "/transferred-transactions",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.transferredTransactions,
      adminController.transferredTransactions,
    );
    this.router.get(
      "/all-transactions",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.getAllTransactions,
      adminController.getAllTransactions,
    );
    this.router.get(
      "/earning-details",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.getEarningDetails,
      adminController.getEarningDetails,
    );

    // `stripe connect product` routes
    this.router.post(
      "/product",
      authorize(PERMISSIONS.STRIPE_CONNECT_PRODUCTS_MANAGE),
      stripeConnectValidators.createProduct,
      adminController.createProduct,
    );
    this.router.put(
      "/product/:id",
      authorize(PERMISSIONS.STRIPE_CONNECT_PRODUCTS_MANAGE),
      stripeConnectValidators.editProduct,
      adminController.editProduct,
    );
    this.router.delete(
      "/product/:id",
      authorize(PERMISSIONS.STRIPE_CONNECT_PRODUCTS_MANAGE),
      stripeConnectValidators.deleteProduct,
      adminController.deleteProduct,
    );

    // charts related end points
    this.router.get(
      "/earnings",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.getEarnings,
      adminController.getEarnings,
    );

    this.router.get(
      "/transactions",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.getTransactionDetails,
      adminController.getTransactionDetails,
    );
    this.router.get(
      "/transactions/count",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.countTransactionByStatus,
      adminController.countTransactionByStatus,
    );
    this.router.get(
      "/transactions/export",
      authorize(PERMISSIONS.STRIPE_CONNECT_TRANSACTIONS_MANAGE),
      stripeConnectValidators.exportTransactions,
      adminController.exportTransactions,
    );
  }
}

export class SuperAdminStripeConnectRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.superAdminMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const superAdminController = new StripeConnectSuperAdminController();

    // Stripe transactions (includes stripe payment, stripe connect, stripe subscriptions etc.)
    this.router.get(
      "/stripe-transactions",
      stripeConnectValidators.getTransactions,
      superAdminController.getTransactions,
    );
    this.router.get(
      "/stripe-transactions/count",
      stripeConnectValidators.countTransactions,
      superAdminController.countTransactions,
    );
    this.router.get(
      "/stripe-transactions/export",
      stripeConnectValidators.exportTransactions,
      superAdminController.exportTransactions,
    );

    // Vendor management routes
    this.router.get(
      "/vendors",
      stripeConnectValidators.getAllVendors,
      superAdminController.getAllVendors,
    );
  }
}
