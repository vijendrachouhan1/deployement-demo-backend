export interface ISendSmsOptions {
  to: string;
  message: string;
  from?: string;
}

export interface ISmsResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ISmsProvider {
  /**
   * Send a single SMS message
   * @param options - SMS sending options
   * @returns Promise with SMS response
   */
  sendMessage(options: ISendSmsOptions): Promise<ISmsResponse>;
}
