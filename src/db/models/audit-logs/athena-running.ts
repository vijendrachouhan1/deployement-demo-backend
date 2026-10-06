import mongoose from "mongoose";

export interface IAthenaRunning {
  _id: string;
  userId: string;
  queryId: string;
  expiresAt: Date;
}

export interface IAthenaRunningDocument extends IAthenaRunning {
  createdAt: Date;
  updatedAt: Date;
}

const AthenaRunningSchema = new mongoose.Schema<IAthenaRunningDocument>(
  {
    _id: {
      type: String,
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
    queryId: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "athena_running",
    _id: false,
  },
);

AthenaRunningSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AthenaRunningSchema.index({ userId: 1, expiresAt: 1 });

export { AthenaRunningSchema };

export const AthenaRunningModel = mongoose.model<IAthenaRunningDocument>(
  "AthenaRunning",
  AthenaRunningSchema,
);
