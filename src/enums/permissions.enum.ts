export enum PERMISSIONS {
  AUDIT_LOGS_VIEW = "audit-logs:view",
  AUDIT_LOGS_MANAGE = "audit-logs:manage",

  DASHBOARD_VIEW = "dashboard:view",
  DASHBOARD_WRITE = "dashboard:write",
  DASHBOARD_MANAGE = "dashboard:manage",

  CARDS_VIEW = "cards:view",
  CARDS_WRITE = "cards:write",
  CARDS_MANAGE = "cards:manage",

  CHAT_VIEW = "chat:view",
  CHAT_WRITE = "chat:write",
  CHAT_MANAGE = "chat:manage",

  COMPANY_VIEW = "company:view",
  COMPANY_WRITE = "company:write",
  COMPANY_MANAGE = "company:manage",

  ERROR_LOGS_VIEW = "error-logs:view",
  ERROR_LOGS_WRITE = "error-logs:write",
  ERROR_LOGS_MANAGE = "error-logs:manage",

  TEAMS_VIEW = "teams:view",
  TEAMS_WRITE = "teams:write",
  TEAMS_MANAGE = "teams:manage",

  NOTIFICATIONS_VIEW = "notifications:view",
  NOTIFICATIONS_WRITE = "notifications:write",
  NOTIFICATIONS_MANAGE = "notifications:manage",

  PRODUCTS_VIEW = "products:view",
  PRODUCTS_WRITE = "products:write",
  PRODUCTS_MANAGE = "products:manage",

  REFERRALS_VIEW = "referrals:view",
  REFERRALS_WRITE = "referrals:write",
  REFERRALS_MANAGE = "referrals:manage",

  STRIPE_CONNECT_ONBOARDING = "stripe-connect:onboarding:manage",

  STRIPE_CONNECT_PRODUCTS_MANAGE = "stripe-connect:products:manage",
  STRIPE_CONNECT_PRODUCTS_VIEW = "stripe-connect:products:view",

  STRIPE_CONNECT_TRANSACTIONS_MANAGE = "stripe-connect:transactions:manage",
  STRIPE_CONNECT_ORDERS_MANAGE = "stripe-connect:my-orders:view",

  STRIPE_PAYMENT_COUPONS_MANAGE = "stripe-payment:coupons:manage",
  STRIPE_PAYMENT_COUPONS_VIEW = "stripe-payment:coupons:view",

  STRIPE_PAYMENT_DASHBOARD_VIEW = "stripe-payment:dashboard:view",

  STRIPE_PAYMENT_ORDERS_VIEW = "stripe-payment:my-orders:view",
  STRIPE_PAYMENT_TRANSACTIONS_MANAGE = "stripe-payment:transactions:manage",

  STRIPE_PAYMENT_PRODUCTS_VIEW = "stripe-payment:products:view",
  STRIPE_PAYMENT_PRODUCTS_MANAGE = "stripe-payment:products:manage",

  SUBSCRIPTION_VIEW = "subscription:view",
  SUBSCRIPTION_WRITE = "subscription:write",
  SUBSCRIPTION_MANAGE = "subscription:manage",

  USER_QUERY_VIEW = "user-query:view",
  USER_QUERY_WRITE = "user-query:write",
  USER_QUERY_MANAGE = "user-query:manage",

  USERS_VIEW = "users:view",
  USERS_WRITE = "users:write",
  USERS_MANAGE = "users:manage",
}
