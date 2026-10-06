import { Subscription } from "@/db/models/subscription";
import { discardUnusedStripeCustomer } from "@/helpers/stripe";
import { paymentGateway } from "@/providers/payment";
import envConfig from "@/config/env";
import Stripe from "stripe";
import { IUser, User } from "@/db/models/user";
import { PaginatedSearchQuery } from "@/types/query.types";
import { createFacetPipeline } from "@/helpers/query";
import { STATUS } from "@/enums";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  STRIPE_INCOMPLETE_SUBSCRIPTION_STATUS,
} from "@/modules/subscription/utils/subscription.constant";
import { mapStripeSubscriptionStatus } from "@/webhooks/subscription/subscription-status.helper";
import {
  ISubscription,
  IUserPlanResponse,
} from "@/modules/subscription/utils/subscription.types";
import { TObjectId } from "@/types";

class SubscriptionHelper {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  /**
   * Find all subscription plans from Stripe
   */
  findAllSubscriptionPlans = async () => {
    // stripe product plan list
    const products = await this.stripe.products.list({ limit: 6 });
    const activeProducts = products.data.filter((product) => product.active);

    // Fetch plans for each product
    const productsWithPlans = await Promise.all(
      activeProducts.map(async (product) => {
        const plans = await this.stripe.plans.list({
          product: product.id,
          limit: 10,
        });
        return { ...product, plans: plans.data };
      }),
    );

    return productsWithPlans;
  };

  /**
   * Find user plans by company reference
   */
  findUserPlans = async (
    companyRef: TObjectId,
  ): Promise<IUserPlanResponse | null> => {
    const subscription = await Subscription.findOne({
      companyRef,
      status: { $in: LIVE_SUBSCRIPTION_STATUSES },
    }).sort({ createdAt: -1 });
    if (!subscription) {
      return null;
    }

    // A live row with no productId still means the caller is subscribed.
    // Returning null here reads as "on the free plan" to changeSubscription,
    // which then opens a second paid subscription alongside this one.
    const product = subscription.productId
      ? await this.stripe.products.retrieve(subscription.productId)
      : null;

    return {
      planName: subscription?.planName,
      price: subscription?.price,
      description: product?.description || "",
      period: subscription?.period || "",
      features: product?.marketing_features || "",
      planId: subscription?.planId,
      stripeSubscriptionId: subscription?.stripeSubscriptionId,
      billingCycle: subscription?.currentPeriodEnds,
      subscriptionCancellationRequested:
        subscription?.subscriptionCancellationRequested ?? false,
    };
  };

  /**
   * Reconcile a customer's subscriptions with Stripe, from one listing.
   *
   * Abandoned attempts are cancelled, and whatever Stripe still holds live is
   * returned. findUserPlans reads a row only the webhook writes, so it reports
   * "free" for the whole round trip after a subscription goes live — creating
   * on that basis opens a second paid subscription beside the first.
   */
  settleStripeSubscriptions = async (stripeCustomerId: string) => {
    const subscriptions =
      await paymentGateway.listCustomerSubscriptions(stripeCustomerId);

    await Promise.all(
      subscriptions
        .filter(
          (subscription) =>
            subscription.status === STRIPE_INCOMPLETE_SUBSCRIPTION_STATUS,
        )
        .map((subscription) =>
          paymentGateway.cancelSubscriptionImmediately(subscription.id),
        ),
    );

    return (
      subscriptions.find((subscription) => {
        const localStatus = mapStripeSubscriptionStatus(subscription.status);
        return (
          localStatus !== null &&
          (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(
            localStatus,
          )
        );
      }) ?? null
    );
  };

  /**
   * Create a new subscription document
   */
  createSubscription = async (document: ISubscription) => {
    return Subscription.create(document);
  };

  findCompanySubscription = async (
    stripeSubscriptionId: string,
    companyRef: TObjectId,
  ) => {
    return Subscription.findOne({ stripeSubscriptionId, companyRef });
  };

  markCancellationRequested = async (id: TObjectId) => {
    return Subscription.findByIdAndUpdate(id, {
      subscriptionCancellationRequested: true,
    });
  };

  /**
   * Create a Stripe customer for a user
   */
  createStripeCustomer = async (user: IUser) => {
    if (user.stripeCustomerId) {
      return user;
    }

    // `fullName` is a virtual, and req.user is lean — so it is absent there.
    const fullName =
      user.fullName ??
      [user.name?.first, user.name?.last].filter(Boolean).join(" ");

    const newCustomer = await paymentGateway.createCustomer(
      fullName,
      user.email,
    );
    // A concurrent call may have written one between the check above and here.
    // Whichever id lands on the user is the one the rest of the app reads, so
    // the loser has to adopt it rather than overwrite it — a SetupIntent built
    // on the discarded customer would save the card where nothing looks.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, stripeCustomerId: null },
      {
        stripeCustomerId: newCustomer.id,
      },
      { new: true },
    );

    if (!claimed) {
      const winner = await User.findById(user._id);
      await discardUnusedStripeCustomer(
        newCustomer.id,
        winner?.stripeCustomerId,
      );
      return winner;
    }

    user.stripeCustomerId = newCustomer.id;
    return claimed;
  };

  /**
   * Find all subscribed users (Super Admin)
   */
  findAll = async (query: PaginatedSearchQuery) => {
    const { page = 1, pageSize = 10, searchValue } = query;
    const skips = (page - 1) * pageSize;

    const facetPipeline = createFacetPipeline(page, skips, pageSize);

    return Subscription.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userRef",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $match: searchValue?.length
          ? {
              $or: [
                { "user.name.first": { $regex: searchValue, $options: "i" } },
                { "user.name.last": { $regex: searchValue, $options: "i" } },
                { planName: { $regex: searchValue, $options: "i" } },
              ],
              status: STATUS.ACTIVE,
            }
          : { status: STATUS.ACTIVE },
      },
      ...facetPipeline,
    ]);
  };
}

export const subscriptionHelper = new SubscriptionHelper();
