import { Middleware } from "@/middleware/auth";
import { StripePaymentController } from "@/modules/stripe-payment/stripe-payment.controller";
import { StripePaymentAdminController } from "@/modules/stripe-payment/stripe-payment-admin.controller";
import { stripePaymentValidators } from "@/modules/stripe-payment/utils/stripe-payment.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class StripePaymentRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new StripePaymentController();

    this.router.get(
      "/product",
      authorize(PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_VIEW),
      stripePaymentValidators.product,
      controller.product,
    );

    // `stripe transaction` routes
    this.router.get(
      "/orders",
      authorize(PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW),
      stripePaymentValidators.pastOrders,
      controller.pastOrders,
    );
    this.router.get(
      "/orders/count",
      authorize(PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW),
      controller.ordersCount,
    );
    this.router.post(
      "/refund/:id",
      authorize(PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW),
      stripePaymentValidators.refundOrder,
      controller.refundOrder,
    );

    // `stripe checkout` routes
    this.router.post(
      "/create-checkout-session",
      authorize(PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_VIEW),
      stripePaymentValidators.createCheckoutSession,
      controller.createCheckoutSession,
    );
    this.router.get(
      "/session-status",
      authorize(PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW),
      stripePaymentValidators.sessionStatus,
      controller.retrieveCheckoutSession,
    );
  }
}

export class AdminStripePaymentRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new StripePaymentAdminController();

    // `stripe payment product` routes
    this.router.post(
      "/product",
      authorize(PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_MANAGE),
      stripePaymentValidators.createProduct,
      adminController.createProduct,
    );
    this.router.put(
      "/product/:id",
      authorize(PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_MANAGE),
      stripePaymentValidators.editProduct,
      adminController.editProduct,
    );
    this.router.delete(
      "/product/:id",
      authorize(PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_MANAGE),
      stripePaymentValidators.deleteProduct,
      adminController.deleteProduct,
    );

    // `stripe payment earnings` routes
    this.router.get(
      "/earning-chart",
      authorize(PERMISSIONS.STRIPE_PAYMENT_TRANSACTIONS_MANAGE),
      stripePaymentValidators.getEarningChart,
      adminController.getEarningChart,
    );

    // `stripe coupon` routes
    this.router.post(
      "/coupon",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_MANAGE),
      stripePaymentValidators.createCoupon,
      adminController.createCoupon,
    );
    this.router.get(
      "/coupon",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_VIEW),
      stripePaymentValidators.listCoupons,
      adminController.listCoupons,
    );
    this.router.get(
      "/coupon/:couponId",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_VIEW),
      stripePaymentValidators.getCoupon,
      adminController.getCoupon,
    );
    this.router.put(
      "/coupon/:couponId",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_MANAGE),
      stripePaymentValidators.editCoupon,
      adminController.editCoupon,
    );
    this.router.delete(
      "/coupon/:couponId",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_MANAGE),
      stripePaymentValidators.deleteCoupon,
      adminController.deleteCoupon,
    );

    // `stripe promotion code` routes
    this.router.post(
      "/promotion-code",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_MANAGE),
      stripePaymentValidators.createPromotionCode,
      adminController.createPromotionCode,
    );
    this.router.get(
      "/promotion-code/:couponId",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_VIEW),
      stripePaymentValidators.listPromotionCodes,
      adminController.listPromotionCodes,
    );
    this.router.put(
      "/promotion-code/:promotionCodeId",
      authorize(PERMISSIONS.STRIPE_PAYMENT_COUPONS_MANAGE),
      stripePaymentValidators.updatePromotionCode,
      adminController.updatePromotionCode,
    );

    // `stripe payment transactions` routes
    this.router.get(
      "/transactions",
      authorize(PERMISSIONS.STRIPE_PAYMENT_TRANSACTIONS_MANAGE),
      stripePaymentValidators.getTransactions,
      adminController.getTransactions,
    );
    this.router.get(
      "/transactions/count",
      authorize(PERMISSIONS.STRIPE_PAYMENT_TRANSACTIONS_MANAGE),
      stripePaymentValidators.countTransactions,
      adminController.countTransactions,
    );
    this.router.get(
      "/transactions/export",
      authorize(PERMISSIONS.STRIPE_PAYMENT_TRANSACTIONS_MANAGE),
      stripePaymentValidators.exportTransactions,
      adminController.exportTransactions,
    );
  }
}
