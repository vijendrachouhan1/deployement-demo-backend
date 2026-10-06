import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";
import { recordEmail } from "@/providers/email/local-email.store";
import {
  IEmailProvider,
  ISendEmailParams,
  TSendTemplateEmailParams,
} from "@/providers/email/utils/email.types";

function toArray(value?: string | string[]): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export class LocalEmailProvider implements IEmailProvider {
  async sendEmail(params: ISendEmailParams): Promise<void> {
    recordEmail({
      to: toArray(params.to) ?? [],
      from: params.from,
      cc: toArray(params.cc),
      bcc: toArray(params.bcc),
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    console.log(
      `[local-email] Captured "${params.subject}" to ${toArray(params.to)?.join(", ")}`,
    );
  }

  async sendTemplateEmail<T extends EMAIL_TEMPLATE_NAME>(
    params: TSendTemplateEmailParams<T>,
  ): Promise<void> {
    recordEmail({
      to: [params.to],
      from: params.from,
      cc: toArray(params.cc),
      bcc: toArray(params.bcc),
      templateName: params.templateName,
      templateData: params.templateData,
    });
    console.log(
      `[local-email] Captured template "${params.templateName}" to ${params.to}`,
    );
  }
}
