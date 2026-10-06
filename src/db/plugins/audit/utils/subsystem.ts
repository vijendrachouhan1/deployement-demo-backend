import mongoose from "mongoose";

export enum SystemSubsystem {
  AUTH = "auth",
  MIGRATION = "migration",
  ATHENA = "athena",
  RBAC = "rbac",
  CRON = "cron",
  OTHER = "other",
}

export const SYSTEM_REF_PREFIX = "SYSTEM:";

export function parseSystemRefShortcut(value: string): SystemSubsystem | null {
  if (!value.startsWith(SYSTEM_REF_PREFIX)) return null;
  const sub = value.slice(SYSTEM_REF_PREFIX.length);
  return (Object.values(SystemSubsystem) as string[]).includes(sub)
    ? (sub as SystemSubsystem)
    : null;
}

export const SUBSYSTEM_MAPPING_VERSION = 1;

/*
 * Stable sentinel ObjectIds for system-event companyRef. Timestamp
 * prefix is all-zeros so naturally generated ObjectIds cannot collide.
 */
export const SYSTEM_SUBSYSTEM_REFS: Record<
  SystemSubsystem,
  mongoose.Types.ObjectId
> = {
  [SystemSubsystem.AUTH]: new mongoose.Types.ObjectId(
    "000000000000000000000001",
  ),
  [SystemSubsystem.MIGRATION]: new mongoose.Types.ObjectId(
    "000000000000000000000002",
  ),
  [SystemSubsystem.ATHENA]: new mongoose.Types.ObjectId(
    "000000000000000000000003",
  ),
  [SystemSubsystem.RBAC]: new mongoose.Types.ObjectId(
    "000000000000000000000004",
  ),
  [SystemSubsystem.CRON]: new mongoose.Types.ObjectId(
    "000000000000000000000005",
  ),
  [SystemSubsystem.OTHER]: new mongoose.Types.ObjectId(
    "000000000000000000000006",
  ),
};
