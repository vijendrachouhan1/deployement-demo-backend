import {
  ISmsProvider,
  ISendSmsOptions,
  ISmsResponse,
} from "@/providers/sms/utils/sms.types";

export class SNSProvider implements ISmsProvider {
  async sendMessage(_options: ISendSmsOptions): Promise<ISmsResponse> {
    throw new Error("SNSProvider.sendMessage() not implemented");
  }
}
