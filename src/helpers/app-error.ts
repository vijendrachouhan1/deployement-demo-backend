import { ERROR_TYPE } from "@/enums";

export interface IAppError extends Error {
  statusCode: number;
  isOperational?: boolean;
}

export class AppError extends Error implements IAppError {
  public readonly type: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    type: string = ERROR_TYPE.GENERIC,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
