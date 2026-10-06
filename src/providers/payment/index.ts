import { StripeCommonProvider } from "@/providers/payment/stripe/stripe-common.provider";
import { StripeConnectProvider } from "@/providers/payment/stripe/stripe-connect.provider";
import { StripePaymentProvider } from "@/providers/payment/stripe/stripe-payment.provider";
import { StripeSubscriptionProvider } from "@/providers/payment/stripe/stripe-subscription.provider";
import { TCreateTransfer } from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TCreateCheckoutSession } from "@/modules/stripe-payment/utils/stripe-payment.types";
import {
  TBalanceTransactions,
  TCreateCoupon,
  TCreatePaymentIntent,
  TCreatePromotionCode,
  TCreateSubscriptionResult,
  TListCoupons,
  TListPromotionCodes,
  TUpdateSubscriptionResult,
} from "@/providers/payment/stripe/stripe.types";

/**
 * Unified Payment Gateway Service
 *
 * This service consolidates all Stripe-related functionality into a single interface
 * for use across the application. It provides methods for:
 * - Customer management
 * - Payment processing (PaymentIntents, Checkout Sessions)
 * - Stripe Connect (account management, transfers)
 * - Subscriptions (create, update, cancel)
 * - Coupons and Promotion Codes
 * - Refunds and Balance Transactions
 * - Webhook event verification
 */
export class PaymentGatewayService {
  private readonly stripeCommon: StripeCommonProvider;
  private readonly stripeConnect: StripeConnectProvider;
  private readonly stripePayment: StripePaymentProvider;
  private readonly stripeSubscription: StripeSubscriptionProvider;
  constructor() {
    this.stripeCommon = new StripeCommonProvider();
    this.stripeConnect = new StripeConnectProvider();
    this.stripePayment = new StripePaymentProvider();
    this.stripeSubscription = new StripeSubscriptionProvider();
  }

  // ========================================
  // CUSTOMER MANAGEMENT
  // ========================================

  /**
   * Creates a new Stripe customer with the given name and email.
   */
  public createCustomer = async (name: string, email: string) => {
    return this.stripeCommon.createStripeCustomer(name, email);
  };

  /**
   * Retrieves a Stripe customer by their ID.
   */
  public getCustomer = async (customerId: string) => {
    return this.stripeCommon.getCustomer(customerId);
  };

  // ========================================
  // PAYMENT PROCESSING
  // ========================================

  /**
   * Creates a PaymentIntent for direct payment processing.
   */
  public createPaymentIntent = async (params: TCreatePaymentIntent) => {
    return this.stripeCommon.createPaymentIntent(params);
  };

  /**
   * Retrieves a PaymentIntent by its ID.
   */
  public retrievePaymentIntent = async (paymentIntentId: string) => {
    return this.stripeCommon.retrievePaymentIntent(paymentIntentId);
  };

  /**
   * Creates a checkout session for Stripe Checkout.
   */
  public createCheckoutSession = async (params: TCreateCheckoutSession) => {
    return this.stripePayment.createCheckoutSession(params);
  };

  /**
   * Retrieves a checkout session from Stripe.
   */
  public retrieveCheckoutSession = async (
    sessionId: string,
    expand?: string[],
  ) => {
    return this.stripePayment.retrieveCheckoutSession(sessionId, expand);
  };

  public retrieveInvoice = async (invoiceId: string) => {
    return this.stripeCommon.retrieveInvoice(invoiceId);
  };

  // ========================================
  // STRIPE CONNECT
  // ========================================

  /**
   * Creates a new Stripe Connect account.
   */
  public createConnectAccount = async () => {
    return this.stripeConnect.createAccount();
  };

  /**
   * Creates an account session for Stripe Connect onboarding.
   */
  public createAccountSession = async (accountId: string) => {
    return this.stripeConnect.createAccountSession(accountId);
  };

  /**
   * Creates a dashboard login link for a connected account.
   */
  public createDashboardLink = async (accountId: string) => {
    return this.stripeConnect.createDashboardLink(accountId);
  };

  /**
   * Retrieves a connected account by ID.
   */
  public getConnectAccount = async (accountId: string) => {
    return this.stripeConnect.getAccount(accountId);
  };

  /**
   * Creates a transfer to a connected account.
   */
  public createTransfer = async (params: TCreateTransfer) => {
    return this.stripeConnect.createTransfer(params);
  };

  // ========================================
  // SUBSCRIPTIONS
  // ========================================

  /**
   * Creates a new subscription for a customer.
   */
  public createSubscription = async (
    customerId: string,
    priceId: string,
  ): Promise<TCreateSubscriptionResult> => {
    return this.stripeSubscription.createNewSubscription(customerId, priceId);
  };

  /**
   * Updates an existing subscription to a new price.
   */
  public updateSubscription = async (
    subscriptionId: string,
    newPriceId: string,
  ): Promise<TUpdateSubscriptionResult> => {
    return this.stripeSubscription.updateExistingSubscription(
      subscriptionId,
      newPriceId,
    );
  };

  /**
   * Cancels a subscription at the end of the current period.
   */
  public cancelSubscription = async (subscriptionId: string) => {
    return this.stripeSubscription.cancelSubscription(subscriptionId);
  };

  /**
   * Lists every subscription Stripe holds for a customer, in any status.
   */
  public listCustomerSubscriptions = async (customerId: string) => {
    return this.stripeSubscription.listCustomerSubscriptions(customerId);
  };

  /**
   * Ends a subscription now, rather than at the end of the period.
   */
  public cancelSubscriptionImmediately = async (subscriptionId: string) => {
    return this.stripeSubscription.cancelSubscriptionImmediately(
      subscriptionId,
    );
  };

  /**
   * Fetches and deletes incomplete subscriptions for a customer.
   */
  public cleanupIncompleteSubscriptions = async (customerId: string) => {
    return this.stripeSubscription.fetchAndDeleteExistingSubscriptions(
      customerId,
    );
  };

  // ========================================
  // COUPONS & PROMOTION CODES
  // ========================================

  /**
   * Creates a new coupon in Stripe.
   */
  public createCoupon = async (params: TCreateCoupon) => {
    return this.stripeCommon.createCoupon(params);
  };

  /**
   * Retrieves a list of all coupons.
   */
  public listCoupons = async (params: TListCoupons) => {
    return this.stripeCommon.listCoupons(params);
  };

  /**
   * Retrieves a coupon by ID.
   */
  public getCoupon = async (couponId: string) => {
    return this.stripeCommon.getCoupon(couponId);
  };

  /**
   * Updates a coupon.
   */
  public updateCoupon = async (
    couponId: string,
    data: Partial<TCreateCoupon>,
  ) => {
    return this.stripeCommon.editCoupon(couponId, data);
  };

  /**
   * Deletes a coupon.
   */
  public deleteCoupon = async (couponId: string) => {
    return this.stripeCommon.deleteCoupon(couponId);
  };

  /**
   * Creates a new promotion code.
   */
  public createPromotionCode = async (params: TCreatePromotionCode) => {
    return this.stripeCommon.createPromotionCode(params);
  };

  /**
   * Retrieves a list of promotion codes.
   */
  public listPromotionCodes = async (params: TListPromotionCodes) => {
    return this.stripeCommon.listPromotionCodes(params);
  };

  /**
   * Updates a promotion code.
   */
  public updatePromotionCode = async (
    promotionCodeId: string,
    params: Partial<TCreatePromotionCode>,
  ) => {
    return this.stripeCommon.updatePromotionCode(promotionCodeId, params);
  };

  // ========================================
  // REFUNDS & TRANSACTIONS
  // ========================================

  public retrieveCharge = async (chargeId: string) => {
    return this.stripeCommon.retrieveCharge(chargeId);
  };

  /**
   * Creates a refund for a charge.
   */
  public createRefund = async (chargeId: string) => {
    return this.stripeCommon.createRefund(chargeId);
  };

  /**
   * Retrieves balance transactions.
   */
  public getBalanceTransactions = async (params: TBalanceTransactions) => {
    return this.stripeCommon.balanceTransactions(params);
  };

  /**
   * Retrieves balance transactions for a connected account.
   */
  public getConnectBalanceTransactions = async (
    params: TBalanceTransactions,
    options: { stripeAccount?: string },
  ) => {
    return this.stripeConnect.balanceTransactions(params, options);
  };

  /**
   * Retrieves an invoice by ID.
   */
  public getInvoice = async (invoiceId: string) => {
    return this.stripeCommon.retrieveInvoice(invoiceId);
  };

  // ========================================
  // WEBHOOK VERIFICATION
  // ========================================

  /**
   * Verifies and constructs a webhook event for general Stripe webhooks.
   */
  public verifyWebhookEvent = async (
    body: string,
    signature: string,
    secret: string,
  ) => {
    return this.stripeCommon.constructEvent(body, signature, secret);
  };

  /**
   * Verifies and constructs a webhook event for Stripe Connect webhooks.
   */
  public verifyConnectWebhookEvent = async (
    body: string,
    signature: string,
  ) => {
    return this.stripeConnect.constructEvent(body, signature);
  };

  /**
   * Verifies and constructs a webhook event for Stripe Payment webhooks.
   */
  public verifyPaymentWebhookEvent = async (
    body: string,
    signature: string,
  ) => {
    return this.stripePayment.constructEvent(body, signature);
  };

  /**
   * E2E test-account cleanup, and discarding a customer created moments ago
   * that lost its claim. Never the app's normal soft-delete flow.
   */
  public deleteCustomer = async (customerId: string) => {
    return this.stripeCommon.deleteStripeCustomer(customerId);
  };
}

export const paymentGateway = new PaymentGatewayService();
