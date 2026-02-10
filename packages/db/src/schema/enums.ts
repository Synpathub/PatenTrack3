import { pgEnum } from 'drizzle-orm/pg-core';

// --- Auth & Users ---
export const userRoleEnum = pgEnum('user_role', ['member', 'admin', 'super_admin']);
export const hashAlgorithmEnum = pgEnum('hash_algorithm', ['bcrypt', 'argon2id']);
export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'microsoft']);

// --- Organizations ---
export const environmentModeEnum = pgEnum('environment_mode', ['PRO', 'DEV', 'STAGING']);
export const orgStatusEnum = pgEnum('org_status', ['active', 'suspended', 'trial']);

// --- Patents ---
export const documentTypeEnum = pgEnum('document_type', ['patent', 'application']);

// --- Assignments & Conveyances ---
export const conveyanceTypeEnum = pgEnum('conveyance_type', [
  'assignment',
  'employee',
  'govern',
  'merger',
  'namechg',
  'license',
  'release',
  'security',
  'correct',
  'missing',
]);

// --- Dashboard ---
export const dashboardTabEnum = pgEnum('dashboard_tab', [
  'complete',       // tab 0 — complete chains
  'broken',         // tab 1 — broken title chains
  'encumbered',     // tab 2 — security interests
  'other',          // tab 3 — mergers, name changes, etc.
]);

// --- Share Links ---
export const shareExpiryEnum = pgEnum('share_expiry', [
  '1h',
  '24h',
  '7d',
  '30d',
  '90d',
  'never',
]);

// --- Ingestion ---
export const ingestionSourceEnum = pgEnum('ingestion_source', [
  'assignments',
  'bibliographic',
  'epo_family',
  'cpc',
  'maintenance',
  'enrichment',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'waiting',
  'active',
  'completed',
  'failed',
  'dead_letter',
]);

export const pipelineStepEnum = pgEnum('pipeline_step', [
  'classify',
  'flag',
  'tree',
  'timeline',
  'broken_title',
  'dashboard',
  'summary',
  'generate_json',
]);

// --- Maintenance Fees ---
export const maintenanceFeeStatusEnum = pgEnum('maintenance_fee_status', [
  'paid',
  'due',
  'surcharge',
  'expired',
  'unknown',
]);
