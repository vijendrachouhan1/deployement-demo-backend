import {
  ISmsProvider,
  ISendSmsOptions,
  ISmsResponse,
} from "@/providers/sms/utils/sms.types";

export class VonageProvider implements ISmsProvider {
  async sendMessage(_options: ISendSmsOptions): Promise<ISmsResponse> {
    throw new Error("VonageProvider.sendMessage() not implemented");
  }
}
