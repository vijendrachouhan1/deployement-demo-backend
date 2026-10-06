import type mongoose from "mongoose";

import type { IAuditLog } from "@/db/models/audit-logs/audit-log";
import type { IColdChainRow } from "@/providers/audit-logs/utils/audit-provider.types";

export interface IChainBreak {
  entryId: string;
  position: number;
  expected: string;
  actual: string;
  tier: "hot" | "cold" | "boundary";
  type: "signature" | "linkage" | "payload_drift" | "head";
}

export interface IRetentionLag {
  count: number;
  oldestTimestamp: Date;
  newestTimestamp: Date;
}

export interface IChainVerifyReport {
  companyRef: string;
  totalEntries: number;
  hotEntries: number;
  coldEntries: number;
  coldTier: boolean;
  breaksFound: number;
  breaks: IChainBreak[];
  firstEntry: Date | null;
  lastEntry: Date | null;
  verifiedAt: Date;
  status: "clean" | "tampered";
  anchorUnverified?: true;
  retentionLag?: IRetentionLag;
  duplicatesSkipped?: number;
}

/*
 * One row shape for the cross-tier merge. A hot row always carries its live
 * `hotRow` + `mongoId` (for the signed-bytes recompute and the cursor); a cold
 * row carries neither. `storedPayload` is the cold tier's verification source
 * and the hot tier's drift cross-check subject.
 */
export interface IWalkRowBase {
  entryId: string;
  idHex: string;
  timestamp: Date;
  sig: string;
  prevSig: string;
  storedPayload: string | null;
  timestampUnparseable?: true;
}

export interface IHotWalkRow extends IWalkRowBase {
  tier: "hot";
  hotRow: IAuditLog;
  mongoId: mongoose.Types.ObjectId;
}

export interface IColdWalkRow extends IWalkRowBase {
  tier: "cold";
  hotRow: null;
  mongoId: null;
}

export type IWalkRow = IHotWalkRow | IColdWalkRow;

export type ColdChainReader = (
  companyRef: string,
) => AsyncIterable<IColdChainRow>;
