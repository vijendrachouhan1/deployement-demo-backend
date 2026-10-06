import { E2E_CLEANUP_STATUS } from "@/modules/e2e-support/utils/e2e-support.enum";

export interface IDeleteTestUserParams {
  email: string;
}

export interface IDeleteTestUserResult {
  deleted: boolean;
  userId?: string;
  /** True when the user's own single-member company was deleted along with them. */
  companyDeleted: boolean;
  external: {
    authProviderMembership: E2E_CLEANUP_STATUS;
    authProviderUser: E2E_CLEANUP_STATUS;
    authProviderOrganization: E2E_CLEANUP_STATUS;
    streamChat: E2E_CLEANUP_STATUS;
    stripeCustomer: E2E_CLEANUP_STATUS;
  };
  externalErrors: string[];
  mongoDeleted: Record<string, number>;
}
export type E2eCheckoutSessionDetails = {
  sessionId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  amountTotal: number | null;
};
