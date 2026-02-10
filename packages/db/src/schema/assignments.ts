import {
  pgTable, uuid, text, timestamp, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

// =============================================================================
// Assignments (global — raw USPTO data)
// =============================================================================

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    rfId: text('rf_id').notNull().unique(), // Reel-frame (e.g., "012345/0678")
    conveyanceText: text('conveyance_text').notNull(),
    recordDate: timestamp('record_date', { withTimezone: true }),
    executionDate: timestamp('execution_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_assignments_rf_id').on(table.rfId),
    index('idx_assignments_record_date').on(table.recordDate),
  ],
);

// =============================================================================
// Assignment Assignors
// =============================================================================

export const assignmentAssignors = pgTable(
  'assignment_assignors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id),
    rfId: text('rf_id').notNull(),
    name: text('name').notNull(),
    executionDate: timestamp('execution_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_assignors_assignment_id').on(table.assignmentId),
    index('idx_assignors_rf_id').on(table.rfId),
    index('idx_assignors_name').on(table.name),
  ],
);

// =============================================================================
// Assignment Assignees
// =============================================================================

export const assignmentAssignees = pgTable(
  'assignment_assignees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id),
    rfId: text('rf_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_assignees_assignment_id').on(table.assignmentId),
    index('idx_assignees_rf_id').on(table.rfId),
    index('idx_assignees_name').on(table.name),
  ],
);

// =============================================================================
// Assignment Documents (which patents an assignment affects)
// =============================================================================

export const assignmentDocuments = pgTable(
  'assignment_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assignmentId: uuid('assignment_id').notNull().references(() => assignments.id),
    rfId: text('rf_id').notNull(),
    documentNumber: text('document_number').notNull(),
    documentType: text('document_type'), // 'patent' | 'application'
    country: text('country').default('US'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_assignment_docs_assignment_id').on(table.assignmentId),
    index('idx_assignment_docs_doc_number').on(table.documentNumber),
    index('idx_assignment_docs_rf_id').on(table.rfId),
  ],
);
