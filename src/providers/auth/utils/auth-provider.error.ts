import type { TErrorCode } from "@/constants/error-codes";

export class AuthProviderError extends Error {
  readonly code: TErrorCode;
  readonly status: number;

  constructor(
    message: string,
    options: { code: TErrorCode; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "AuthProviderError";
    this.code = options.code;
    this.status = options.status ?? 400;
  }
}
