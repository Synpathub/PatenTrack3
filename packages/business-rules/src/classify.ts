/**
 * Transaction Type Classification
 *
 * Classifies patent assignment conveyance text into standardized types.
 * This is Step 1 of the processing pipeline.
 *
 * Source: update_missing_type.php, update_record_daily_xml.php
 * Business Rules: BR-001 through BR-012
 */

import {
  CLASSIFICATION_RULES,
  CONVEYANCE_TYPES,
  type ConveyanceType,
} from '@patentrack/shared';

export interface ClassificationResult {
  conveyType: ConveyanceType;
  employerAssign: boolean;
  matchedRule: number;
}

export function classifyConveyance(conveyText: string): ClassificationResult {
  if (!conveyText || conveyText.trim().length === 0) {
    return {
      conveyType: CONVEYANCE_TYPES.MISSING,
      employerAssign: false,
      matchedRule: -1,
    };
  }

  const lowerText = conveyText.toLowerCase();

  for (let i = 0; i < CLASSIFICATION_RULES.length; i++) {
    const rule = CLASSIFICATION_RULES[i];
    const matched = rule.keywords.some((keyword) => lowerText.includes(keyword));

    if (matched) {
      return {
        conveyType: rule.conveyType,
        employerAssign: rule.employerAssign,
        matchedRule: i,
      };
    }
  }

  return {
    conveyType: CONVEYANCE_TYPES.MISSING,
    employerAssign: false,
    matchedRule: -1,
  };
}

export function classifyBatch(
  items: { rfId: string; conveyText: string }[]
): (ClassificationResult & { rfId: string })[] {
  return items.map((item) => ({
    rfId: item.rfId,
    ...classifyConveyance(item.conveyText),
  }));
}

export function isOwnershipTransfer(conveyType: ConveyanceType): boolean {
  return ([
    CONVEYANCE_TYPES.ASSIGNMENT,
    CONVEYANCE_TYPES.EMPLOYEE,
    CONVEYANCE_TYPES.MERGER,
    CONVEYANCE_TYPES.GOVERN,
    CONVEYANCE_TYPES.CORRECT,
  ] as ConveyanceType[]).includes(conveyType);
}

export function isEncumbrance(conveyType: ConveyanceType): boolean {
  return conveyType === CONVEYANCE_TYPES.SECURITY;
}

export function isRelease(conveyType: ConveyanceType): boolean {
  return conveyType === CONVEYANCE_TYPES.RELEASE;
}
