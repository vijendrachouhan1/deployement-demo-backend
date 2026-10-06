export enum AuditCategory {
  AUTHENTICATION = "authentication",
  ADMIN_ACTION = "admin_action",
  RBAC = "rbac",
  TENANT = "tenant",
  SYSTEM = "system",
  AUDIT_META = "audit_meta",
  RECORD_CHANGE = "record_change",
}

export enum AuditStatus {
  SUCCESS = "success",
  FAILURE = "failure",
}

export enum AuditTargetType {
  USER = "User",
  COMPANY = "Company",
  ROLE = "Role",
}

export enum AuditAction {
  USER_LOGIN_SUCCESS = "user.login.success",
  USER_LOGIN_FAILURE = "user.login.failure",
  USER_LOGIN_MFA_REQUIRED = "user.login.mfa_required",
  USER_LOGOUT = "user.logout",
  USER_STATUS_CHANGED = "user.status.changed",
  USER_ROLE_CHANGED = "user.role.changed",
  USER_PROFILE_UPDATED = "user.profile.updated",
  USER_PASSWORD_FORCE_CHANGE = "user.password.force_change",
  USER_PASSWORD_CHANGED_BY_SUPER_ADMIN = "user.password.changed_by_super_admin",
  COMPANY_FORCE_PASSWORD_CHANGE = "company.force_password_change",
  COMPANY_USER_ROLE_CHANGED = "company.user.role.changed",
  COMPANY_STATUS_CHANGED = "company.status.changed",
  COMPANY_UPDATED = "company.updated",
  ROLE_CREATED = "role.created",
  ROLE_UPDATED = "role.updated",
  ROLE_DELETED = "role.deleted",
  PERMISSION_DENIED = "permission.denied",
  ATHENA_QUERY_EXECUTED = "athena.query_executed",
  ADMIN_EXPORT_RUN = "admin.export_run",
}
