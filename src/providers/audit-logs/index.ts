// Importing this barrel self-registers the Mongo adapter (see mongo.provider).
export {
  MongoAuditProvider,
  mongoAuditProvider,
} from "@/providers/audit-logs/mongo.provider";
export { getActiveAuditStorageProvider } from "@/db/plugins/audit/provider-registry";
