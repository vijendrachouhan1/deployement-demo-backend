import mongoose from "mongoose";
import { HTTP_METHOD } from "@/modules/error-logs/utils/error-log.enum";
import { ERROR_TYPE } from "@/enums";

const ObjectId = mongoose.Schema.Types.ObjectId;

export interface IErrorLog {
  _id: mongoose.Types.ObjectId;
  name?: string;
  message?: string;
  stackTrace?: string;
  type: ERROR_TYPE;
  request?: IErrorLogRequest;
  context?: IErrorLogContext;
  isImportant?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IErrorLogRequest {
  method?: HTTP_METHOD;
  statusCode?: number;
  url?: string;
  path?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

export interface IErrorLogContext {
  userRef?: mongoose.Types.ObjectId;
  userAgent?: string;
  ip?: string;
}

export interface IErrorLogDocument extends IErrorLog, mongoose.Document {
  createdAt: Date;
  updatedAt: Date;
}

const ErrorLogSchema = new mongoose.Schema<IErrorLogDocument>(
  {
    // Basic Error Information
    name: {
      type: String,
    },
    message: {
      type: String,
    },
    stackTrace: {
      type: String,
    },
    type: {
      type: String,
      enum: Object.values(ERROR_TYPE),
      default: ERROR_TYPE.GENERIC,
    },

    // Request Context
    request: {
      method: {
        type: String,
        enum: Object.values(HTTP_METHOD),
      },
      statusCode: {
        type: Number,
      },
      url: {
        type: String,
      },
      path: {
        type: String,
      },
      headers: {
        type: Object,
        default: {},
      },
      query: {
        type: Object,
        default: {},
      },
      params: {
        type: Object,
        default: {},
      },
      body: {
        type: Object,
        default: {},
      },
    },

    // user context
    context: {
      userRef: {
        type: ObjectId,
        ref: "User",
      },
      userAgent: {
        type: String,
      },
      ip: {
        type: String,
      },
    },

    // additional info
    // This key marks a request for permanent storage, ensuring it isn't deleted during the monthly cleanup run by cron.
    isImportant: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

ErrorLogSchema.index({ timestamp: -1 });

export const ErrorLogs = mongoose.model<IErrorLogDocument>(
  "ErrorLogs",
  ErrorLogSchema,
);
