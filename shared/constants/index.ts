export const LICENSE_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
} as const;

export const SUBSCRIPTION_TIERS = {
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
} as const;

export const USER_ROLES = {
  MASTER: 'master',
  COMPANY: 'company',
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
} as const;

export const ADMIN_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REMOVED: 'removed',
} as const;

export const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  REMOVED: 'removed',
} as const;

export const QR_CODE_TYPES = {
  CHECKPOINT: 'checkpoint',
  ITEM: 'item',
  TROLLEY: 'trolley',
  SEAL: 'seal',
} as const;

export const PROCESS_CATEGORIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
} as const;

export const PROCESS_RUN_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  BREACHED: 'breached',
} as const;

export const SEVERITY_MODELS = {
  MULTI_LEVEL: 'multi_level',
  PASS_FAIL: 'pass_fail',
} as const;

export const ALERT_STATUS = {
  ACTIVE: 'active',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
} as const;

export const ALERT_TYPES = {
  INDIVIDUAL: 'individual',
  COLLECTIVE: 'collective',
} as const;

export const EMAIL_CODE_PURPOSES = {
  REGISTRATION: 'registration',
  SIGN_IN: 'sign_in',
  PASSWORD_CHANGE: 'password_change',
} as const;

export const DEFAULTS = {
  LICENSE_VALIDATION_INTERVAL_HOURS: 24,
  LICENSE_GRACE_PERIOD_HOURS: 72,
  EMAIL_CODE_EXPIRY_MINUTES: 10,
  FILE_STORAGE_PATH: '/data/uploads',
  APP_PORT: 3000,
  API_PORT: 4000,
  MAX_UPLOAD_SIZE_MB: 10,
  SESSION_EXPIRY_HOURS: 24,
  DEFAULT_PROCESS_TIME_LIMIT: 120,
} as const;

export const COLLECTIVE_ALERT_THRESHOLDS = {
  SINGLE_PROCESS_BREACHES: 2,
  MULTI_PROCESS_BREACHES: 3,
} as const;
