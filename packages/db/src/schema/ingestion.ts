import {
  pgTable, uuid, text, timestamp, integer, jsonb, index,
} from 'drizzle-orm/pg-core';
import { ingestionSourceEnum, jobStatusEnum, pipelineStepEnum } from './enums';
import { organizations } from './organizations';

// =============================================================================
// Ingestion Runs (Stage 1 — source ingestion tracking)
// =============================================================================

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: ingestionSourceEnum('source').notNull(),
    status: jobStatusEnum('status').notNull().default('waiting'),
    recordsProcessed: integer('records_processed').default(0),
    recordsSkipped: integer('records_skipped').default(0),
    recordsFailed: integer('records_failed').default(0),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata'), // Source-specific details (file URL, size, etc.)
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ingestion_runs_source').on(table.source),
    index('idx_ingestion_runs_status').on(table.status),
    index('idx_ingestion_runs_created_at').on(table.createdAt),
  ],
);

// =============================================================================
// Pipeline Runs (Stage 2 — per-org pipeline tracking)
// =============================================================================

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    trigger: text('trigger').notNull(), // 'daily-assignments', 'manual', 'rebuild', etc.
    status: jobStatusEnum('status').notNull().default('waiting'),
    currentStep: pipelineStepEnum('current_step'),
    stepsCompleted: text('steps_completed').array().default([]),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pipeline_runs_org_id').on(table.orgId),
    index('idx_pipeline_runs_status').on(table.status),
    index('idx_pipeline_runs_created_at').on(table.createdAt),
  ],
);

// =============================================================================
// Data Freshness (monitoring — when each source last succeeded)
// =============================================================================

export const dataFreshness = pgTable(
  'data_freshness',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: ingestionSourceEnum('source').notNull().unique(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastRecordCount: integer('last_record_count'),
    expectedIntervalHours: integer('expected_interval_hours').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
