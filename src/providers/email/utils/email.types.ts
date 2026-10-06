import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";

export interface ISendEmailParams {
  subject: string;
  to: string | string[];
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  html?: string;
  text?: string;
}

export type TEmailTemplateDataMap = {
  [EMAIL_TEMPLATE_NAME.VERIFY_OTP]: {
    otp: string;
  };
  [EMAIL_TEMPLATE_NAME.RESET_PASSWORD]: {
    resetLink: string;
    name: string;
  };
  [EMAIL_TEMPLATE_NAME.WELCOME]: {
    name: string;
  };
  [EMAIL_TEMPLATE_NAME.INVITE_USER]: {
    name: string;
    inviteLink: string;
  };
  [EMAIL_TEMPLATE_NAME.MAGIC_LINK_LOGIN]: {
    magicLink: string;
  };
};

export type TSendTemplateEmailParams<
  T extends EMAIL_TEMPLATE_NAME = EMAIL_TEMPLATE_NAME,
> = {
  from?: string;
  to: string;
  templateName: T;
  templateData: TEmailTemplateDataMap[T];
  cc?: string | string[];
  bcc?: string | string[];
};

export interface IEmailProvider {
  sendEmail(params: ISendEmailParams): Promise<void>;
  sendTemplateEmail<T extends EMAIL_TEMPLATE_NAME>(
    params: TSendTemplateEmailParams<T>,
  ): Promise<void>;
}
