import twilio from "twilio";
import envConfig from "@/config/env";
import {
  ISmsProvider,
  ISendSmsOptions,
  ISmsResponse,
} from "@/providers/sms/utils/sms.types";
import { validatePhoneNumber } from "@/helpers/common";

// twilio ships as CommonJS with no named exports under ESM — take the Twilio
// class off the default export instead of importing it by name.
const { Twilio } = twilio;

export class TwilioProvider implements ISmsProvider {
  private readonly client: InstanceType<typeof Twilio>;
  private readonly twilioNumber: string;

  constructor() {
    this.client = new Twilio(
      envConfig.TWILIO_ACCOUNTSID,
      envConfig.TWILIO_AUTHTOKEN,
    );
    this.twilioNumber = envConfig.TWILIO_NUMBER;
  }

  async sendMessage(options: ISendSmsOptions): Promise<ISmsResponse> {
    try {
      const { to, message, from } = options;

      // Validate phone number format
      if (!validatePhoneNumber(to)) {
        return {
          success: false,
          error: `Invalid phone number format: ${to}. Must be in E.164 format.`,
        };
      }

      const response = await this.client.messages.create({
        body: message,
        to,
        from: from ?? this.twilioNumber,
      });

      return {
        success: true,
        messageId: response.sid,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to send SMS message",
      };
    }
  }
}
