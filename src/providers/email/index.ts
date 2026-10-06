import { EMAIL_PROVIDER, EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";
import {
  IEmailProvider,
  ISendEmailParams,
  TSendTemplateEmailParams,
} from "@/providers/email/utils/email.types";
import { SendGridProvider } from "@/providers/email/sendgrid.provider";
import { AwsSesProvider } from "@/providers/email/ses.provider";
import { LocalEmailProvider } from "@/providers/email/local.provider";
import { isDevEnvironment } from "@/helpers/common";

function defaultEmailProvider(): EMAIL_PROVIDER {
  return isDevEnvironment() ? EMAIL_PROVIDER.LOCAL : EMAIL_PROVIDER.AWS;
}

export class EmailService {
  private readonly provider: IEmailProvider;
  constructor(emailProvider: EMAIL_PROVIDER = defaultEmailProvider()) {
    this.provider = createEmailProvider(emailProvider);
  }

  sendEmail(params: ISendEmailParams) {
    return this.provider.sendEmail(params);
  }

  sendTemplateEmail<T extends EMAIL_TEMPLATE_NAME>(
    params: TSendTemplateEmailParams<T>,
  ) {
    return this.provider.sendTemplateEmail(params);
  }
}

function createEmailProvider(emailProvider: EMAIL_PROVIDER) {
  switch (emailProvider) {
    case EMAIL_PROVIDER.AWS:
      return new AwsSesProvider();
    case EMAIL_PROVIDER.SENDGRID:
      return new SendGridProvider();
    case EMAIL_PROVIDER.LOCAL:
      if (!isDevEnvironment()) {
        throw new Error("Local email provider is allowed only in development");
      }
      return new LocalEmailProvider();
    default:
      throw new Error("Invalid email provider");
  }
}

export const emailService = new EmailService();
