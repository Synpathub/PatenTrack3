import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { conveyanceTypeEnum, dashboardTabEnum } from './enums.js';
import { organizations } from './organizations.js';
import { patents } from './patents.js';
import { assignments } from './assignments.js';

// =============================================================================
// Org Assets (which patents an org monitors)
// =============================================================================

export const orgAssets = pgTable(
  'org_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    patentId: uuid('patent_id').notNull().references(() => patents.id),
    documentId: text('document_id').notNull(), // Patent or app number for quick lookup
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_org_assets_org_patent').on(table.orgId, table.patentId),
    index('idx_org_assets_org_id').on(table.orgId),
    index('idx_org_assets_document_id').on(table.documentId),
  ],
);

// =============================================================================
// Org Assignments (per-org classified view of assignments)
// =============================================================================

export const orgAssignments = pgTable(
  'org_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id),
    rfId: text('rf_id').notNull(),
    documentId: text('document_id').notNull(),
    conveyanceType: conveyanceTypeEnum('conveyance_type'),
    isEmployerAssignment: boolean('is_employer_assignment').notNull().default(false),
    flagged: boolean('flagged').notNull().default(false),
    flagReason: text('flag_reason'),
    needsReclassification: boolean('needs_reclassification').notNull().default(false),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    recordDate: timestamp('record_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_org_assignments_org_assignment').on(table.orgId, table.assignmentId),
    index('idx_org_assignments_org_id').on(table.orgId),
    index('idx_org_assignments_document_id').on(table.documentId),
    index('idx_org_assignments_conveyance_type').on(table.conveyanceType),
    index('idx_org_assignments_record_date').on(table.recordDate),
    index('idx_org_assignments_flagged').on(table.flagged),
  ],
);

// =============================================================================
// Entities (normalized assignor/assignee names per org)
// =============================================================================

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    canonicalName: text('canonical_name').notNull(),
    representativeId: uuid('representative_id'), // Self-referencing for entity groups
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_entities_org_id').on(table.orgId),
    index('idx_entities_canonical_name').on(table.canonicalName),
    index('idx_entities_representative_id').on(table.representativeId),
  ],
);

// =============================================================================
// Entity Aliases (variant names grouped under canonical entity)
// =============================================================================

export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    levenshteinDistance: integer('levenshtein_distance'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_entity_aliases_entity_id').on(table.entityId),
    index('idx_entity_aliases_org_id').on(table.orgId),
    index('idx_entity_aliases_name').on(table.name),
  ],
);

// =============================================================================
// Companies (org portfolio companies with enrichment data)
// =============================================================================

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    domain: text('domain'),
    logoUrl: text('logo_url'),
    enrichedAt: timestamp('enriched_at', { withTimezone: true }),
    enrichmentData: jsonb('enrichment_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_companies_org_id').on(table.orgId),
    index('idx_companies_name').on(table.name),
  ],
);

// =============================================================================
// Dashboard Items (computed ownership trees per asset)
// =============================================================================

export const dashboardItems = pgTable(
  'dashboard_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    assetId: uuid('asset_id').notNull().references(() => orgAssets.id),
    type: integer('type').notNull(), // BR-024–BR-030: 0=complete, 1=broken, 18=encumbered, etc.
    tab: dashboardTabEnum('tab').notNull(),
    color: text('color'), // BR-031 hex color
    treeJson: jsonb('tree_json'), // Pre-computed tree structure
    isBroken: boolean('is_broken').notNull().default(false),
    brokenReason: text('broken_reason'),
    brokenMissingLink: jsonb('broken_missing_link'), // { from, to }
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_dashboard_items_org_asset').on(table.orgId, table.assetId),
    index('idx_dashboard_items_org_id').on(table.orgId),
    index('idx_dashboard_items_type').on(table.type),
    index('idx_dashboard_items_tab').on(table.tab),
    index('idx_dashboard_items_is_broken').on(table.isBroken),
  ],
);

// =============================================================================
// Summary Metrics (pre-computed dashboard aggregates)
// =============================================================================

export const summaryMetrics = pgTable(
  'summary_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    companyId: uuid('company_id'), // null = org-level (BR-042 convention)
    totalAssets: integer('total_assets').notNull().default(0),
    totalEntities: integer('total_entities').notNull().default(0),
    totalCompanies: integer('total_companies').notNull().default(0),
    totalTransactions: integer('total_transactions').notNull().default(0),
    totalEmployees: integer('total_employees').notNull().default(0),
    totalParties: integer('total_parties').notNull().default(0),
    completeChains: integer('complete_chains').notNull().default(0),
    brokenChains: integer('broken_chains').notNull().default(0),
    encumbrances: integer('encumbrances').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_summary_org_company').on(table.orgId, table.companyId),
    index('idx_summary_org_id').on(table.orgId),
  ],
);

// =============================================================================
// Timeline Entries (pre-computed transaction timeline)
// =============================================================================

export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
    assignmentCount: integer('assignment_count').notNull().default(0),
    types: text('types').array(), // Array of conveyance types active that day
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_timeline_org_date').on(table.orgId, table.entryDate),
    index('idx_timeline_org_id').on(table.orgId),
    index('idx_timeline_entry_date').on(table.entryDate),
  ],
);
