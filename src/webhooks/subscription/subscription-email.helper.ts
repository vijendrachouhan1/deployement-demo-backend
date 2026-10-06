import { emailService } from "@/providers/email";

type TSubscriptionEmailParams = {
  email: string;
  fullName: string;
};

export async function sendSubscriptionCancelledEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: `${fullName}  Subscription cancelled!`,
    text: `
              Hey ${fullName},
              We have successfully cancelled you renewal .
              `,
  });
}

export async function sendNewSubscriptionEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: ` Welcome`,
    text: `
          Hey ${fullName},
          Thanks for joining.
          `,
  });
}

export async function sendSubscriptionRenewalFailedEmail({
  email,
  fullName,
}: TSubscriptionEmailParams) {
  return emailService.sendEmail({
    to: email,
    subject: `${fullName} Welcome`,
    text: `
          Hey ${fullName},
          We were not able to renew your subscription. Please manually renew it.
          `,
  });
}
