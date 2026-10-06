import mongoose from "mongoose";

export interface IMigrationLock {
  _id: string;
  holder: string;
  expiresAt: Date;
}

export interface IMigrationLockDocument extends IMigrationLock {
  createdAt: Date;
  updatedAt: Date;
}

const MigrationLockSchema = new mongoose.Schema<IMigrationLockDocument>(
  {
    _id: {
      type: String,
      required: true,
    },
    holder: {
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
    collection: "migration_lock",
    _id: false,
  },
);

MigrationLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export { MigrationLockSchema };

export const MigrationLockModel = mongoose.model<IMigrationLockDocument>(
  "MigrationLock",
  MigrationLockSchema,
);
