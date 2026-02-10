import {
  pgTable, uuid, text, timestamp, integer, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { documentTypeEnum, maintenanceFeeStatusEnum } from './enums';

// =============================================================================
// Patents (global — not org-specific)
// =============================================================================

export const patents = pgTable(
  'patents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantNumber: text('grant_number'),
    applicationNumber: text('application_number'),
    documentType: documentTypeEnum('document_type').notNull().default('patent'),
    title: text('title'),
    abstract: text('abstract'),
    filingDate: timestamp('filing_date', { withTimezone: true }),
    grantDate: timestamp('grant_date', { withTimezone: true }),
    expirationDate: timestamp('expiration_date', { withTimezone: true }),
    claimsCount: integer('claims_count'),
    independentClaimsCount: integer('independent_claims_count'),
    maintenanceFeeStatus: maintenanceFeeStatusEnum('maintenance_fee_status').default('unknown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_patents_grant_number').on(table.grantNumber),
    uniqueIndex('idx_patents_app_number').on(table.applicationNumber),
    index('idx_patents_filing_date').on(table.filingDate),
    index('idx_patents_grant_date').on(table.grantDate),
  ],
);

// =============================================================================
// Patent Inventors
// =============================================================================

export const patentInventors = pgTable(
  'patent_inventors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patentId: uuid('patent_id').notNull().references(() => patents.id),
    name: text('name').notNull(),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_patent_inventors_patent_id').on(table.patentId),
    index('idx_patent_inventors_name').on(table.name),
  ],
);

// =============================================================================
// Patent Classifications (CPC)
// =============================================================================

export const patentClassifications = pgTable(
  'patent_classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patentId: uuid('patent_id').notNull().references(() => patents.id),
    cpcCode: text('cpc_code').notNull(),
    cpcLevel: text('cpc_level'), // section, class, subclass, group, subgroup
    isInventive: boolean('is_inventive').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_patent_class_patent_id').on(table.patentId),
    index('idx_patent_class_cpc_code').on(table.cpcCode),
  ],
);

// =============================================================================
// CPC Classification Hierarchy (reference data)
// =============================================================================

export const cpcClassifications = pgTable(
  'cpc_classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    title: text('title').notNull(),
    level: text('level').notNull(), // section, class, subclass, group, subgroup
    parentCode: text('parent_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cpc_code').on(table.code),
    index('idx_cpc_parent').on(table.parentCode),
    index('idx_cpc_level').on(table.level),
  ],
);

// =============================================================================
// Patent Families (EPO)
// =============================================================================

export const patentFamilies = pgTable(
  'patent_families',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patentId: uuid('patent_id').notNull().references(() => patents.id),
    familyId: text('family_id').notNull(), // EPO family identifier
    memberCountry: text('member_country').notNull(),
    memberNumber: text('member_number').notNull(),
    memberKind: text('member_kind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_patent_families_patent_id').on(table.patentId),
    index('idx_patent_families_family_id').on(table.familyId),
  ],
);

// =============================================================================
// Maintenance Fee Events
// =============================================================================

export const maintenanceFeeEvents = pgTable(
  'maintenance_fee_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    patentId: uuid('patent_id').notNull().references(() => patents.id),
    eventDate: timestamp('event_date', { withTimezone: true }).notNull(),
    eventCode: text('event_code').notNull(),
    eventDescription: text('event_description'),
    feeAmount: integer('fee_amount'), // cents
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_maint_fee_patent_id').on(table.patentId),
    index('idx_maint_fee_event_date').on(table.eventDate),
  ],
);
