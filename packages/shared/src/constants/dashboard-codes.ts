/**
 * Dashboard item type codes.
 * Source: dashboard_with_company.php, dashboard_with_bank.php
 * Business Rule: BR-037
 */
export const DASHBOARD_TYPES = {
  COMPLETE: 0,
  BROKEN: 1,
  ENCUMBERED: 18,
  LAW_FIRM: 20,
  BANK_30: 30,
  BANK_33: 33,
  BANK_35: 35,
  BANK_36: 36,
} as const;

export type DashboardType = (typeof DASHBOARD_TYPES)[keyof typeof DASHBOARD_TYPES];

/**
 * Activity ID grouping rules.
 * Activities 11, 12, 13, and 16 are grouped as activity 5 in summaries.
 * Source: summary.php
 * Business Rule: BR-038
 */
export const ACTIVITY_GROUP_MAP: Record<number, number> = {
  11: 5,
  12: 5,
  13: 5,
  16: 5,
};

export function resolveActivityGroup(activityId: number): number {
  return ACTIVITY_GROUP_MAP[activityId] ?? activityId;
}

/**
 * Ownership tree node types.
 * Source: tree.php
 * Business Rules: BR-024 through BR-030
 */
export const TREE_NODE_TYPES = {
  EMPLOYEE: { type: 0, tab: 0 },
  EMPLOYEE_ALT: { type: 1, tab: 1 },
  PURCHASE: { type: 1, tab: 1 },
  SALE: { type: 2, tab: 1 },
  MERGER_IN: { type: 3, tab: 1 },
  MERGER_OUT: { type: 4, tab: 1 },
  SECURITY_OUT: { type: 5, tab: 2 },
  SECURITY_IN: { type: 6, tab: 2 },
  RELEASE_OUT: { type: 7, tab: 2 },
  RELEASE_IN: { type: 8, tab: 2 },
  NAME_CHANGE: { type: 9, tab: 3 },
  GOVERN: { type: 10, tab: 3 },
  CORRECT: { type: 11, tab: 3 },
  MISSING: { type: 12, tab: 3 },
  OTHER: { type: 13, tab: 3 },
} as const;

/**
 * Hardcoded filters preserved from legacy.
 * Business Rules: BR-039 through BR-041
 */
export const LEGACY_FILTERS = {
  MIN_APPLICATION_YEAR: 1999,
  DEFAULT_LAYOUT_ID: 15,
  EMPLOYEE_DETECTION_START_YEAR: 1998,
  EMPLOYEE_DETECTION_END_YEAR: 2001,
} as const;
