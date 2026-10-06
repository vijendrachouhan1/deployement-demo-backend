import { createRequire } from "node:module";
import { beforeEach, vi } from "vitest";

import envConfig from "@/config/env";

/*
 * Fake of the `stripe` package. Mocking it makes egress to api.stripe.com impossible
 * by construction — the same guarantee mock-api-client.ts gives the frontend for
 * axios — and it stays correct if another `new Stripe()` construction site appears.
 *
 * setupFiles run before the test file's module graph loads, so this is installed
 * before paymentGateway, cardHelper and subscriptionHelper all
 * construct at module scope.
 */

/*
 * Fixed secrets so a developer's .env.development can't change what the suite
 * signs with (precedent: athena-provider.mock.ts). The webhook handlers read
 * these off envConfig, and src/tests/utils/stripe-webhook.ts signs with them.
 */
export const TEST_WEBHOOK_SECRETS = {
  SUBSCRIPTION: "whsec_test_subscription",
  PAYMENT: "whsec_test_payment",
  CONNECT: "whsec_test_connect",
} as const;

envConfig.STRIPE_SECRET_KEY = "sk_test_boilerplate";
envConfig.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRETS.SUBSCRIPTION;
envConfig.STRIPE_PAYMENT_WEBHOOK_SECRET = TEST_WEBHOOK_SECRETS.PAYMENT;
envConfig.STRIPE_CONNECT_WEBHOOK_SECRET = TEST_WEBHOOK_SECRETS.CONNECT;

/*
 * The real signer/verifier. Stripe.webhooks is a static on the constructor, so
 * genuine HMAC is available with no network and no client instance. createRequire
 * goes through Node's CJS loader, which bypasses Vitest's module registry — so
 * this reaches the real package even though we are mocking it here.
 */
const nodeRequire = createRequire(import.meta.url);
const actualStripe = nodeRequire("stripe") as typeof import("stripe").Stripe;

export const realWebhooks = actualStripe.webhooks;
export const StripeErrors = actualStripe.errors;

/*
 * One shared handle per resource method. The fake class assigns THESE refs onto
 * every instance, so a test's `stripeMock.customers.create.mockResolvedValueOnce()`
 * reaches the already-constructed singletons.
 */
export const stripeMock = {
  customers: { create: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
  paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
  paymentMethods: { list: vi.fn() },
  setupIntents: { create: vi.fn() },
  subscriptions: {
    create: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn(),
  },
  invoices: { retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
  refunds: { create: vi.fn() },
  charges: { retrieve: vi.fn() },
  balanceTransactions: { list: vi.fn() },
  coupons: {
    create: vi.fn(),
    list: vi.fn(),
    retrieve: vi.fn(),
    update: vi.fn(),
    del: vi.fn(),
  },
  promotionCodes: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
  products: { list: vi.fn(), retrieve: vi.fn() },
  plans: { list: vi.fn() },
  accounts: { create: vi.fn(), retrieve: vi.fn(), createLoginLink: vi.fn() },
  accountSessions: { create: vi.fn() },
  transfers: { create: vi.fn() },
  webhooks: { constructEvent: vi.fn() },
};

export class Stripe {
  customers = stripeMock.customers;
  paymentIntents = stripeMock.paymentIntents;
  paymentMethods = stripeMock.paymentMethods;
  setupIntents = stripeMock.setupIntents;
  subscriptions = stripeMock.subscriptions;
  invoices = stripeMock.invoices;
  checkout = stripeMock.checkout;
  refunds = stripeMock.refunds;
  charges = stripeMock.charges;
  balanceTransactions = stripeMock.balanceTransactions;
  coupons = stripeMock.coupons;
  promotionCodes = stripeMock.promotionCodes;
  products = stripeMock.products;
  plans = stripeMock.plans;
  accounts = stripeMock.accounts;
  accountSessions = stripeMock.accountSessions;
  transfers = stripeMock.transfers;
  webhooks = stripeMock.webhooks;

  static webhooks = stripeMock.webhooks;
  static errors = StripeErrors;

  constructor(
    public readonly apiKey?: string,
    public readonly config?: unknown,
  ) {}
}

export default Stripe;

type TMockFn = ReturnType<typeof vi.fn>;

/** Walks stripeMock, yielding "checkout.sessions.create"-style paths. */
function eachStripeFn(
  cb: (path: string, fn: TMockFn) => void,
  node: Record<string, unknown> = stripeMock,
  prefix = "",
) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") cb(path, value as TMockFn);
    else eachStripeFn(cb, value as Record<string, unknown>, path);
  }
}

/*
 * mockReset/restoreMocks strip implementations before every test, so all
 * defaults have to be reinstalled here. Tests override with mockResolvedValueOnce.
 */
beforeEach(() => {
  eachStripeFn((path, fn) => {
    // An un-stubbed Stripe call is a test bug. Failing loudly here beats
    // resolving undefined and blowing up three frames away.
    fn.mockRejectedValue(
      new Error(
        `[stripe.mock] Unstubbed Stripe call: stripe.${path}(). Stub it via stripeMock.${path}.`,
      ),
    );
  });

  // Real HMAC by default so signature-failure paths are genuinely exercised.
  // Throws synchronously; the providers' async constructEvent turns that into a
  // rejection, which is what the handlers' try/catch expects.
  stripeMock.webhooks.constructEvent.mockImplementation(
    (body: string | Buffer, signature: string, secret: string) =>
      realWebhooks.constructEvent(body, signature, secret),
  );
});

vi.mock("stripe", () => import("@/tests/mocks/stripe.mock.js"));
