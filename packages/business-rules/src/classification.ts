/**
 * Conveyance classification engine (BR-001 through BR-010)
 *
 * Classifies raw USPTO conveyance text into structured types.
 * This is PatenTrack's core business logic.
 */

export type ConveyanceType =
  | 'assignment' | 'employee' | 'govern' | 'merger' | 'namechg'
  | 'license' | 'release' | 'security' | 'correct' | 'missing';

export interface ClassificationResult {
  type: ConveyanceType;
  isEmployer: boolean;
  confidence: number;
  matchedRule: string;
}

const CONVEYANCE_PATTERNS: Array<{
  type: ConveyanceType;
  patterns: RegExp[];
  rule: string;
}> = [
  {
    type: 'employee',
    patterns: [
      /EMPLOYMENT AGREEMENT/i,
      /EMPLOYER/i,
      /EMPLOYEE PATENT AGREEMENT/i,
      /EMPLOYEE INVENTION/i,
    ],
    rule: 'BR-002',
  },
  {
    type: 'govern',
    patterns: [/GOVERNMENT INTEREST/i, /CONFIRMATORY LICENSE.*GOVERNMENT/i],
    rule: 'BR-003',
  },
  {
    type: 'merger',
    patterns: [
      /\bMERGER\b/i,
      /CHANGE OF NAME.*MERGER/i,
      /CERTIFICATE OF MERGER/i,
    ],
    rule: 'BR-004',
  },
  {
    type: 'namechg',
    patterns: [
      /CHANGE OF NAME/i,
      /NAME CHANGE/i,
      /CERTIFICATE OF.*NAME/i,
    ],
    rule: 'BR-005',
  },
  {
    type: 'license',
    patterns: [/\bLICENSE\b/i, /\bLICENSING\b/i, /EXCLUSIVE LICENSE/i],
    rule: 'BR-006',
  },
  {
    type: 'release',
    patterns: [
      /RELEASE BY SECURED PARTY/i,
      /\bRELEASE\b/i,
      /TERMINATION.*SECURITY/i,
    ],
    rule: 'BR-007',
  },
  {
    type: 'security',
    patterns: [
      /SECURITY INTEREST/i,
      /SECURITY AGREEMENT/i,
      /GRANT OF SECURITY/i,
    ],
    rule: 'BR-008',
  },
  {
    type: 'correct',
    patterns: [
      /CORRECT/i,
      /CORRECTION/i,
      /CORRECTIVE ASSIGNMENT/i,
      /NUNC PRO TUNC/i,
    ],
    rule: 'BR-009',
  },
  {
    type: 'assignment',
    patterns: [/ASSIGNMENT OF ASSIGNORS INTEREST/i, /\bASSIGNMENT\b/i],
    rule: 'BR-001',
  },
];

/**
 * Classify raw conveyance text into a structured type.
 *
 * Order matters: more specific patterns (employee, govern) are checked
 * before generic ones (assignment) to avoid false positives.
 */
export function classifyConveyance(text: string): ClassificationResult {
  const normalized = text.toUpperCase().trim();

  for (const { type, patterns, rule } of CONVEYANCE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        const isEmployer =
          type === 'employee' || /EMPLOYER|EMPLOYMENT/.test(normalized);

        return { type, isEmployer, confidence: 1.0, matchedRule: rule };
      }
    }
  }

  // BR-010: Default to 'missing' if no classification matches
  return { type: 'missing', isEmployer: false, confidence: 0.0, matchedRule: 'BR-010' };
}
