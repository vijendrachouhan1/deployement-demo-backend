import { StripeConnectCustomer } from "@/db/models/stripeConnect/customer";
import { IUser } from "@/db/models/user";
import {
  TCreateCustomer,
  TUpdateCustomer,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { discardUnusedStripeCustomer } from "@/helpers/stripe";
import { paymentGateway } from "@/providers/payment";
import { TObjectId } from "@/types/common.types";

const MONGO_DUPLICATE_KEY = 11000;

export async function createCustomer({
  userRef,
  stripeCustomerId,
  companyRef,
}: TCreateCustomer) {
  return StripeConnectCustomer.create({
    userRef,
    stripeCustomerId,
    companyRef,
  });
}

export async function updateCustomer({ userRef, update }: TUpdateCustomer) {
  return StripeConnectCustomer.findOneAndUpdate({ userRef }, update);
}

export async function getCustomer(userRef: TObjectId) {
  return StripeConnectCustomer.findOne({ userRef });
}

/**
 * The only path that may create a Connect customer. Concurrent first purchases
 * used to each create one at Stripe and the last write won, orphaning the
 * loser's orders; the unique index on `userRef` is what makes the upsert
 * serialize.
 */
export async function resolveCustomerId(user: IUser): Promise<string> {
  const existing = await getCustomer(user._id);
  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const name = [user.name?.first, user.name?.last].filter(Boolean).join(" ");
  const stripeCustomer = await paymentGateway.createCustomer(name, user.email);

  try {
    const claimed = await StripeConnectCustomer.findOneAndUpdate(
      { userRef: user._id },
      {
        $setOnInsert: {
          userRef: user._id,
          companyRef: user.companyRef,
          stripeCustomerId: stripeCustomer.id,
        },
      },
      { upsert: true, new: true },
    );

    await discardUnusedStripeCustomer(
      stripeCustomer.id,
      claimed.stripeCustomerId,
    );

    return claimed.stripeCustomerId;
  } catch (error) {
    if ((error as { code?: number }).code !== MONGO_DUPLICATE_KEY) {
      throw error;
    }

    const winner = await getCustomer(user._id);
    if (!winner) {
      throw error;
    }

    await discardUnusedStripeCustomer(
      stripeCustomer.id,
      winner.stripeCustomerId,
    );

    return winner.stripeCustomerId;
  }
}
