import {
  CreateTemplateCommand,
  CreateTemplateRequest,
  DeleteTemplateCommand,
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  UpdateTemplateCommand,
} from "@aws-sdk/client-ses";
import envConfig from "@/config/env";
import { isDevEnvironment, isStaging } from "@/helpers/common";
import {
  ISendEmailParams,
  TSendTemplateEmailParams,
  IEmailProvider,
} from "@/providers/email/utils/email.types";
import { EMAIL_TEMPLATE_NAME } from "@/enums/email.enum";

export class AwsSesProvider implements IEmailProvider {
  private readonly ses: SESClient;
  private readonly senderEmail = envConfig.SES_SENDER_EMAIL;
  private readonly testEmail = envConfig.SES_TEST_EMAIL;

  constructor() {
    this.ses = new SESClient({
      region: envConfig.S3_BUCKET_REGION,
      credentials: {
        accessKeyId: envConfig.AWS_USER_KEY,
        secretAccessKey: envConfig.AWS_USER_SECRET,
      },
    });
  }

  async sendEmail(params: ISendEmailParams): Promise<void> {
    const { to, cc, bcc } = this.resolveRecipients(params);

    if (isDevEnvironment() || isStaging()) {
      params.from = this.senderEmail;
      console.log("Sending email via SES:", {
        to,
        cc,
        bcc,
      });
    }

    const command = new SendEmailCommand({
      Source: params.from ?? this.senderEmail,
      Destination: {
        ToAddresses: to,
        ...(cc && { CcAddresses: cc }),
        ...(bcc && { BccAddresses: bcc }),
      },
      Message: {
        Subject: { Charset: "UTF-8", Data: params.subject },
        Body: {
          ...(params.html && {
            Html: { Charset: "UTF-8", Data: params.html },
          }),
          ...(params.text && {
            Text: { Charset: "UTF-8", Data: params.text },
          }),
        },
      },
    });

    await this.ses.send(command);
  }

  async sendTemplateEmail<T extends EMAIL_TEMPLATE_NAME>(
    params: TSendTemplateEmailParams<T>,
  ): Promise<void> {
    const { to, cc, bcc } = this.resolveRecipients(params);

    const command = new SendTemplatedEmailCommand({
      Source: params.from ?? this.senderEmail,
      Template: params.templateName,
      TemplateData: JSON.stringify(params.templateData),
      Destination: {
        ToAddresses: to,
        ...(cc && { CcAddresses: cc }),
        ...(bcc && { BccAddresses: bcc }),
      },
    });

    await this.ses.send(command);
  }

  /* ---------------- Template Management ---------------- */

  createTemplate(params: CreateTemplateRequest) {
    return this.ses.send(new CreateTemplateCommand(params));
  }

  updateTemplate(params: CreateTemplateRequest) {
    return this.ses.send(new UpdateTemplateCommand(params));
  }

  deleteTemplate(name: string) {
    return this.ses.send(new DeleteTemplateCommand({ TemplateName: name }));
  }

  /* ---------------- Helpers ---------------- */

  private resolveRecipients(params: {
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
  }) {
    const isNonProd = isDevEnvironment() || isStaging();

    const to = isNonProd
      ? [this.testEmail]
      : Array.isArray(params.to)
        ? params.to
        : [params.to];

    return {
      to,
      cc: params.cc
        ? Array.isArray(params.cc)
          ? params.cc
          : [params.cc]
        : undefined,
      bcc: params.bcc
        ? Array.isArray(params.bcc)
          ? params.bcc
          : [params.bcc]
        : undefined,
    };
  }
}
