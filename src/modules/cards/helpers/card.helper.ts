import { paymentGateway } from "@/providers/payment";
import Stripe from "stripe";
import envConfig from "@/config/env";
import { IUser } from "@/db/models/user";
import { subscriptionHelper } from "@/modules/subscription/helpers/subscription.helper";

class CardHelper {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  /** Delegates so `createStripeCustomer` stays the only writer of the id. */
  resolveCustomerId = async (user: IUser) => {
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const ensuredUser = await subscriptionHelper.createStripeCustomer(user);
    return ensuredUser?.stripeCustomerId;
  };

  listCards = async (customerId: string) => {
    return this.stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
  };

  getCustomer = async (customerId: string) => {
    return paymentGateway.getCustomer(customerId);
  };

  isCustomerDeleted = (
    customerResponse: Stripe.Customer | Stripe.DeletedCustomer,
  ): boolean => {
    return "deleted" in customerResponse && customerResponse.deleted === true;
  };

  getDefaultPaymentMethodId = (
    customer: Stripe.Customer,
  ): string | null | undefined => {
    return customer.invoice_settings?.default_payment_method as
      string | null | undefined;
  };

  createSetupIntent = async (customerId: string) => {
    return this.stripe.setupIntents.create({ customer: customerId });
  };

  setDefaultCard = async (
    customerId: string,
    paymentMethodId: string | null,
  ) => {
    return this.stripe.customers.update(customerId, {
      invoice_settings: {
        // Stripe clears the default only for "". undefined is dropped by the
        // SDK and leaves the old default in place.
        default_payment_method: paymentMethodId ?? "",
      },
    });
  };
}

export const cardHelper = new CardHelper();
