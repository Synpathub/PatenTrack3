/**
 * Patent assignment conveyance types.
 * These map directly to the `conveyance_type` enum in the database schema
 * and to the legacy classification system in update_missing_type.php.
 *
 * Business Rules: BR-001 through BR-012
 */

export const CONVEYANCE_TYPES = {
  ASSIGNMENT: 'assignment',
  EMPLOYEE: 'employee',
  GOVERN: 'govern',
  MERGER: 'merger',
  NAME_CHANGE: 'namechg',
  LICENSE: 'license',
  RELEASE: 'release',
  SECURITY: 'security',
  CORRECT: 'correct',
  MISSING: 'missing',
} as const;

export type ConveyanceType = (typeof CONVEYANCE_TYPES)[keyof typeof CONVEYANCE_TYPES];

/**
 * Classification rules applied in priority order.
 * Each rule checks if the conveyance text contains any of the keywords.
 * First match wins — order matters!
 *
 * Source: update_missing_type.php, update_record_daily_xml.php
 * Business Rule: BR-007 through BR-012
 */
export const CLASSIFICATION_RULES: {
  keywords: string[];
  conveyType: ConveyanceType;
  employerAssign: boolean;
}[] = [
  {
    keywords: ['correct', 're-record'],
    conveyType: CONVEYANCE_TYPES.CORRECT,
    employerAssign: false,
  },
  {
    keywords: ['employee', 'employment'],
    conveyType: CONVEYANCE_TYPES.EMPLOYEE,
    employerAssign: true,
  },
  {
    keywords: ['confirmator'],
    conveyType: CONVEYANCE_TYPES.GOVERN,
    employerAssign: false,
  },
  {
    keywords: ['merger'],
    conveyType: CONVEYANCE_TYPES.MERGER,
    employerAssign: false,
  },
  {
    keywords: ['change of name', 'change of address'],
    conveyType: CONVEYANCE_TYPES.NAME_CHANGE,
    employerAssign: false,
  },
  {
    keywords: ['license', 'letters of testamentary'],
    conveyType: CONVEYANCE_TYPES.LICENSE,
    employerAssign: false,
  },
  {
    keywords: ['release'],
    conveyType: CONVEYANCE_TYPES.RELEASE,
    employerAssign: false,
  },
  {
    keywords: ['security', 'mortgage'],
    conveyType: CONVEYANCE_TYPES.SECURITY,
    employerAssign: false,
  },
  {
    keywords: ['assignment'],
    conveyType: CONVEYANCE_TYPES.ASSIGNMENT,
    employerAssign: false,
  },
];

/**
 * Visual color mapping for the D3 ownership diagram.
 * Source: tree.php, generate_json.php
 * Business Rule: BR-031
 */
export const CONVEYANCE_COLORS: Record<string, string> = {
  [CONVEYANCE_TYPES.ASSIGNMENT]: '#E60000',
  [CONVEYANCE_TYPES.NAME_CHANGE]: '#2493f2',
  [CONVEYANCE_TYPES.SECURITY]: '#ffaa00',
  [CONVEYANCE_TYPES.RELEASE]: '#70A800',
  [CONVEYANCE_TYPES.LICENSE]: '#E6E600',
};

export const DEFAULT_COLOR = '#E60000';

export function getConveyanceColor(conveyType: string): string {
  return CONVEYANCE_COLORS[conveyType] ?? DEFAULT_COLOR;
}
