import { USER_TYPE, PERMISSIONS } from "@/enums";

export const ROLES_MESSAGES = {
  ROLE_FETCHED: "Role fetched successfully.",
  ROLE_CREATED: "Role created successfully.",
  ROLE_UPDATED: "Role updated successfully.",
  ROLE_DELETED: "Role deleted successfully.",
  COMPANY_NOT_FOUND: "Company not found.",
  ROLE_HAS_ASSIGNMENTS:
    "This role cannot be deleted because it still has active assignments.",
  ROLE_HAS_GROUP_ROLE_MAPPINGS:
    "This role cannot be deleted because it still has group role mappings.",
  ROLE_SYNC_FAILED: "Unable to sync role with WorkOS.",
  PERMISSIONS_FETCHED: "Permissions fetched successfully.",
} as const;

export const DEFAULT_ENVIRONMENT_ROLES = [
  {
    slug: USER_TYPE.USER,
    name: "User",
    description: "Base access for standard users.",
    permissions: [
      PERMISSIONS.CARDS_VIEW,
      PERMISSIONS.CHAT_VIEW,
      PERMISSIONS.CHAT_WRITE,
      PERMISSIONS.NOTIFICATIONS_WRITE,
      PERMISSIONS.PRODUCTS_VIEW,
      PERMISSIONS.REFERRALS_VIEW,
      PERMISSIONS.STRIPE_CONNECT_PRODUCTS_VIEW,
      PERMISSIONS.STRIPE_CONNECT_ORDERS_MANAGE,
      PERMISSIONS.STRIPE_PAYMENT_ORDERS_VIEW,
      PERMISSIONS.STRIPE_PAYMENT_PRODUCTS_VIEW,
      PERMISSIONS.SUBSCRIPTION_VIEW,
      PERMISSIONS.USER_QUERY_VIEW,
      PERMISSIONS.USER_QUERY_WRITE,
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.USERS_WRITE,
    ],
  },
  {
    slug: USER_TYPE.ADMIN,
    name: "Admin",
    description: "Administrative access for a single organization.",
    permissions: [
      ...Object.values(PERMISSIONS).filter(
        (permission) =>
          !permission.startsWith("error-logs:") &&
          !permission.startsWith("audit-logs:") &&
          permission.endsWith("manage"),
      ),
      PERMISSIONS.AUDIT_LOGS_VIEW,
    ],
  },
  {
    slug: USER_TYPE.SUPER_ADMIN,
    name: "Super Admin",
    description: "Full access across the environment",
    permissions: Object.values(PERMISSIONS),
  },
  {
    slug: USER_TYPE.SYSTEM,
    name: "System",
    description:
      "Provides access to manage and monitor platform-level features for maintenance purposes",
    permissions: [
      PERMISSIONS.ERROR_LOGS_VIEW,
      PERMISSIONS.ERROR_LOGS_WRITE,
      PERMISSIONS.ERROR_LOGS_MANAGE,
    ],
  },
] as const;

export const PRIVILEGED_USER_ROLES: readonly string[] = [
  USER_TYPE.SUPER_ADMIN,
  USER_TYPE.SYSTEM,
];
