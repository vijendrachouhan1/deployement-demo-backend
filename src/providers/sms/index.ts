import { TwilioProvider } from "@/providers/sms/twilio.provider";
import { SNSProvider } from "@/providers/sms/sns.provider";
import { VonageProvider } from "@/providers/sms/vonage.provider";
import { ISmsProvider, ISendSmsOptions } from "@/providers/sms/utils/sms.types";
import { SMS_PROVIDER } from "@/providers/sms/utils/sms.enum";

/**
 * SmsService - Business logic layer for SMS operations
 *
 * This service acts as a facade over the SMS provider layer,
 * allowing easy switching between different SMS providers (Twilio, SNS, Vonage)
 * without changing the business logic.
 */
export class SmsService {
  private smsProvider: ISmsProvider;
  constructor() {
    this.smsProvider = createSmsProvider(SMS_PROVIDER.TWILIO);
  }

  /**
   * Send a verification code via SMS
   * @param phoneNumber - Recipient phone number in E.164 format
   * @param code - Verification code to send
   * @returns Promise with SMS response
   */
  async sendVerificationCode(phoneNumber: string, code: string) {
    return this.smsProvider.sendMessage({
      to: phoneNumber,
      message: `Your Boilerplate verification code is ${code}`,
    });
  }

  /**
   * Send a custom SMS message
   * @param options - SMS sending options
   * @returns Promise with SMS response
   */
  async sendMessage(options: ISendSmsOptions) {
    return this.smsProvider.sendMessage(options);
  }
}

function createSmsProvider(
  smsProvider: SMS_PROVIDER = SMS_PROVIDER.TWILIO,
): ISmsProvider {
  switch (smsProvider) {
    case SMS_PROVIDER.SNS:
      return new SNSProvider();
    case SMS_PROVIDER.VONAGE:
      return new VonageProvider();
    case SMS_PROVIDER.TWILIO:
    default:
      return new TwilioProvider();
  }
}

export const smsService = new SmsService();
