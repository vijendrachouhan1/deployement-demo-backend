import mongoose from "mongoose";

import { SystemSubsystem } from "@/db/plugins/audit/utils/subsystem";

/*
 * One document per chain. `_id` IS the companyRef in the audit row:
 * tenant chains use the tenant's Company ObjectId; system chains use
 * the matching SYSTEM_SUBSYSTEM_REFS entry. `subsystem` is set only
 * for system chains and exists for monitoring/lookup.
 */
export interface IChainHead {
  _id: mongoose.Types.ObjectId;
  subsystem: SystemSubsystem | null;
  lastSig: string;
  updatedAt: Date;
}

export type IChainHeadDocument = IChainHead;

const ChainHeadSchema = new mongoose.Schema<IChainHeadDocument>(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    subsystem: {
      type: String,
      enum: Object.values(SystemSubsystem),
      default: null,
    },
    lastSig: {
      type: String,
      required: true,
    },
    updatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: "chain_heads",
    _id: false,
  },
);

ChainHeadSchema.index({ subsystem: 1 }, { sparse: true });
ChainHeadSchema.index({ updatedAt: -1 });

export { ChainHeadSchema };

export const ChainHeadModel = mongoose.model<IChainHeadDocument>(
  "ChainHead",
  ChainHeadSchema,
);
