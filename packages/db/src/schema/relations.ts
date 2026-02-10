import { relations } from 'drizzle-orm';
import { organizations } from './organizations.js';
import { users, refreshTokens, oauthAccounts, verificationCodes } from './users.js';
import { patents, patentInventors, patentClassifications, patentFamilies, maintenanceFeeEvents } from './patents.js';
import { assignments, assignmentAssignors, assignmentAssignees, assignmentDocuments } from './assignments.js';
import {
  orgAssets, orgAssignments, entities, entityAliases, companies,
  dashboardItems, summaryMetrics, timelineEntries,
} from './org-intelligence.js';
import { shareLinks, shareAccessLog } from './shares.js';
import { pipelineRuns } from './ingestion.js';

// =============================================================================
// Organization Relations
// =============================================================================

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  orgAssets: many(orgAssets),
  orgAssignments: many(orgAssignments),
  entities: many(entities),
  companies: many(companies),
  shareLinks: many(shareLinks),
  dashboardItems: many(dashboardItems),
  summaryMetrics: many(summaryMetrics),
  timelineEntries: many(timelineEntries),
  pipelineRuns: many(pipelineRuns),
}));

// =============================================================================
// User Relations
// =============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  refreshTokens: many(refreshTokens),
  oauthAccounts: many(oauthAccounts),
  verificationCodes: many(verificationCodes),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

// =============================================================================
// Patent Relations
// =============================================================================

export const patentsRelations = relations(patents, ({ many }) => ({
  inventors: many(patentInventors),
  classifications: many(patentClassifications),
  families: many(patentFamilies),
  maintenanceFeeEvents: many(maintenanceFeeEvents),
  orgAssets: many(orgAssets),
}));

export const patentInventorsRelations = relations(patentInventors, ({ one }) => ({
  patent: one(patents, { fields: [patentInventors.patentId], references: [patents.id] }),
}));

export const patentClassificationsRelations = relations(patentClassifications, ({ one }) => ({
  patent: one(patents, { fields: [patentClassifications.patentId], references: [patents.id] }),
}));

export const patentFamiliesRelations = relations(patentFamilies, ({ one }) => ({
  patent: one(patents, { fields: [patentFamilies.patentId], references: [patents.id] }),
}));

export const maintenanceFeeEventsRelations = relations(maintenanceFeeEvents, ({ one }) => ({
  patent: one(patents, { fields: [maintenanceFeeEvents.patentId], references: [patents.id] }),
}));

// =============================================================================
// Assignment Relations
// =============================================================================

export const assignmentsRelations = relations(assignments, ({ many }) => ({
  assignors: many(assignmentAssignors),
  assignees: many(assignmentAssignees),
  documents: many(assignmentDocuments),
  orgAssignments: many(orgAssignments),
}));

export const assignmentAssignorsRelations = relations(assignmentAssignors, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentAssignors.assignmentId], references: [assignments.id] }),
}));

export const assignmentAssigneesRelations = relations(assignmentAssignees, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentAssignees.assignmentId], references: [assignments.id] }),
}));

export const assignmentDocumentsRelations = relations(assignmentDocuments, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentDocuments.assignmentId], references: [assignments.id] }),
}));

// =============================================================================
// Org Intelligence Relations
// =============================================================================

export const orgAssetsRelations = relations(orgAssets, ({ one, many }) => ({
  organization: one(organizations, { fields: [orgAssets.orgId], references: [organizations.id] }),
  patent: one(patents, { fields: [orgAssets.patentId], references: [patents.id] }),
  dashboardItem: many(dashboardItems),
}));

export const orgAssignmentsRelations = relations(orgAssignments, ({ one }) => ({
  organization: one(organizations, { fields: [orgAssignments.orgId], references: [organizations.id] }),
  assignment: one(assignments, { fields: [orgAssignments.assignmentId], references: [assignments.id] }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  organization: one(organizations, { fields: [entities.orgId], references: [organizations.id] }),
  aliases: many(entityAliases),
}));

export const entityAliasesRelations = relations(entityAliases, ({ one }) => ({
  entity: one(entities, { fields: [entityAliases.entityId], references: [entities.id] }),
}));

export const companiesRelations = relations(companies, ({ one }) => ({
  organization: one(organizations, { fields: [companies.orgId], references: [organizations.id] }),
}));

export const dashboardItemsRelations = relations(dashboardItems, ({ one }) => ({
  organization: one(organizations, { fields: [dashboardItems.orgId], references: [organizations.id] }),
  asset: one(orgAssets, { fields: [dashboardItems.assetId], references: [orgAssets.id] }),
}));

export const summaryMetricsRelations = relations(summaryMetrics, ({ one }) => ({
  organization: one(organizations, { fields: [summaryMetrics.orgId], references: [organizations.id] }),
}));

export const timelineEntriesRelations = relations(timelineEntries, ({ one }) => ({
  organization: one(organizations, { fields: [timelineEntries.orgId], references: [organizations.id] }),
}));

// =============================================================================
// Share Relations
// =============================================================================

export const shareLinksRelations = relations(shareLinks, ({ one, many }) => ({
  organization: one(organizations, { fields: [shareLinks.orgId], references: [organizations.id] }),
  createdByUser: one(users, { fields: [shareLinks.createdBy], references: [users.id] }),
  accessLogs: many(shareAccessLog),
}));

export const shareAccessLogRelations = relations(shareAccessLog, ({ one }) => ({
  shareLink: one(shareLinks, { fields: [shareAccessLog.shareLinkId], references: [shareLinks.id] }),
}));

// =============================================================================
// Pipeline Relations
// =============================================================================

export const pipelineRunsRelations = relations(pipelineRuns, ({ one }) => ({
  organization: one(organizations, { fields: [pipelineRuns.orgId], references: [organizations.id] }),
}));
