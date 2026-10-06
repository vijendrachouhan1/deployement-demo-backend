import envConfig from "@/config/env";
import { TCreateTransfer } from "@/modules/stripe-connect/utils/stripe-connect.types";
import Stripe from "stripe";
import { TBalanceTransactions } from "@/providers/payment/stripe/stripe.types";
import { STRIPE_ACCOUNT } from "@/modules/stripe-connect/utils/stripe-connect.enum";

export class StripeConnectProvider {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY);
  }

  public constructEvent = async (body: string, stripeSignature: string) => {
    return this.stripe.webhooks.constructEvent(
      body,
      stripeSignature,
      envConfig.STRIPE_CONNECT_WEBHOOK_SECRET,
    );
  };

  public createAccount = async () => {
    try {
      return await this.stripe.accounts.create({
        controller: {
          stripe_dashboard: {
            type: STRIPE_ACCOUNT.EXPRESS,
          },
          fees: {
            payer: STRIPE_ACCOUNT.APPLICATION,
          },
          losses: {
            payments: STRIPE_ACCOUNT.APPLICATION,
          },
        },
        capabilities: {
          transfers: {
            requested: true,
          },
        },
      });
    } catch (error) {
      console.error("Error creating connected account:", error);
      throw error;
    }
  };

  public createAccountSession = async (accountId: string) => {
    try {
      return await this.stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: { enabled: true },
        },
      });
    } catch (error) {
      console.error("Error creating connected account session:", error);
      throw error;
    }
  };

  public createDashboardLink = async (accountId: string) => {
    try {
      return await this.stripe.accounts.createLoginLink(accountId);
    } catch (error) {
      console.error("Error creating dashboard link:", error);
      throw error;
    }
  };

  public createTransfer = async ({
    amount,
    currency,
    destination,
    description,
    source_transaction,
  }: TCreateTransfer) => {
    try {
      return await this.stripe.transfers.create({
        amount,
        currency,
        destination,
        description,
        source_transaction,
      });
    } catch (error) {
      console.error("Error transfering funds:", error);
      throw error;
    }
  };

  public balanceTransactions = async (
    params: TBalanceTransactions,
    options: { stripeAccount?: string },
  ) => {
    try {
      return await this.stripe.balanceTransactions.list(params, options);
    } catch (error) {
      console.error("Error getting balance transactions: ", error);
      throw error;
    }
  };

  public getAccount = async (accountId: string) => {
    try {
      return await this.stripe.accounts.retrieve(accountId);
    } catch (error) {
      console.error("Error getting account: ", error);
      throw error;
    }
  };
}
