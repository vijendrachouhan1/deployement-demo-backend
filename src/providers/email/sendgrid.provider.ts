import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";
import {
  IEmailProvider,
  ISendEmailParams,
  TSendTemplateEmailParams,
} from "@/providers/email/utils/email.types";

export class SendGridProvider implements IEmailProvider {
  constructor() {
    throw new Error("SENDGRID PROVIDER is not implemented");
  }

  async sendEmail(_params: ISendEmailParams): Promise<void> {
    throw new Error("SENDGRID sendEmail method is not implemented");
  }

  async sendTemplateEmail<T extends EMAIL_TEMPLATE_NAME>(
    params: TSendTemplateEmailParams<T>,
  ): Promise<void> {
    throw new Error("SENDGRID sendTemplateEmail method is not implemented");
  }
}
