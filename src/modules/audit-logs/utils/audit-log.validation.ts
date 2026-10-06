import { z } from "zod";
import { validate } from "zod-express-validator";

import { validationErrorHandler } from "@/helpers/validation-error";
import { AuditStatus } from "@/enums/audit.enum";
import {
  SYSTEM_REF_PREFIX,
  SystemSubsystem,
} from "@/db/plugins/audit/utils/subsystem";

const SYSTEM_SUBSYSTEM_VALUES = Object.values(SystemSubsystem).join("|");

/*
 * Tenant-ref contract: a 24-hex tenant id or a SYSTEM:<subsystem> shortcut.
 */
const COMPANY_REF_REGEX = new RegExp(
  `^[a-f0-9]{24}$|^${SYSTEM_REF_PREFIX}(${SYSTEM_SUBSYSTEM_VALUES})$`,
);

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/;

const SORT_DIR = z.enum(["asc", "desc"]).optional();
const SORT_BY = z
  .enum([
    "timestamp",
    "createdAt",
    "action",
    "category",
    "actorEmail",
    "status",
  ])
  .optional();

const ISO_DATE = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
    message: "Invalid date",
  });

const MAX_PAGE = 10000;

const HIDE_INTERNAL_CHANGES = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const baseQueryShape = {
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  category: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(128).optional(),
  actorId: z.string().regex(OBJECT_ID_REGEX).optional(),
  actorEmail: z.string().email().optional(),
  status: z.enum(AuditStatus).optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().regex(OBJECT_ID_REGEX).optional(),
  companyRef: z.string().regex(COMPANY_REF_REGEX).optional(),
  from: ISO_DATE,
  to: ISO_DATE,
  sortBy: SORT_BY,
  sortDir: SORT_DIR,
};

export const GetAuditLogsSuperAdminQuerySchema = z.object({
  ...baseQueryShape,
  search: z.string().min(1).max(128).optional(),
  hideInternalChanges: HIDE_INTERNAL_CHANGES,
});

export const GetAuditLogsAdminQuerySchema = z.object({
  ...baseQueryShape,
  hideInternalChanges: HIDE_INTERNAL_CHANGES,
});

const FORMAT = z.enum(["csv", "json"]).optional();

export const ExportAuditLogsAdminQuerySchema = z.object({
  ...baseQueryShape,
  format: FORMAT,
});

export const ExportAuditLogsSuperAdminQuerySchema = z.object({
  ...baseQueryShape,
  search: z.string().min(1).max(128).optional(),
  format: FORMAT,
});

export const GetAuditLogByIdParamsSchema = z.object({
  id: z.string().regex(OBJECT_ID_REGEX, "Invalid id"),
});

/*
 * companyRef is REQUIRED here (unlike baseQueryShape) — a verify always targets
 * one tenant chain.
 */
export const VerifyChainQuerySchema = z.object({
  companyRef: z.string().regex(COMPANY_REF_REGEX),
});

export type GetAuditLogsAdminQuery = z.infer<
  typeof GetAuditLogsAdminQuerySchema
>;
export type GetAuditLogsSuperAdminQuery = z.infer<
  typeof GetAuditLogsSuperAdminQuerySchema
>;
export type ExportAuditLogsAdminQuery = z.infer<
  typeof ExportAuditLogsAdminQuerySchema
>;
export type ExportAuditLogsSuperAdminQuery = z.infer<
  typeof ExportAuditLogsSuperAdminQuerySchema
>;
export type VerifyChainQuery = z.infer<typeof VerifyChainQuerySchema>;

const GetAuditLogsSuperAdminSchema = {
  query: GetAuditLogsSuperAdminQuerySchema,
} as const;

const GetAuditLogsAdminSchema = {
  query: GetAuditLogsAdminQuerySchema,
} as const;

const GetAuditLogByIdSchema = {
  params: GetAuditLogByIdParamsSchema,
} as const;

export const auditLogValidators = {
  getAuditLogsSuperAdmin: validate(
    GetAuditLogsSuperAdminSchema,
    validationErrorHandler,
  ),
  getAuditLogsAdmin: validate(GetAuditLogsAdminSchema, validationErrorHandler),
  getAuditLogById: validate(GetAuditLogByIdSchema, validationErrorHandler),
  exportAuditLogsAdmin: validate(
    { query: ExportAuditLogsAdminQuerySchema },
    validationErrorHandler,
  ),
  exportAuditLogsSuperAdmin: validate(
    { query: ExportAuditLogsSuperAdminQuerySchema },
    validationErrorHandler,
  ),
  verifyChain: validate(
    { query: VerifyChainQuerySchema },
    validationErrorHandler,
  ),
};
