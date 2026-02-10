/**
 * Inventor-Employer Matching
 *
 * Source: inventor_levenshtein.js, update_flag.php
 * Business Rules: BR-021 through BR-023
 */

import { levenshteinDistance } from './normalize';

export interface InventorName {
  firstName: string;
  lastName: string;
  middleName?: string;
}

export interface InventorMatchResult {
  matched: boolean;
  matchedVariation?: string;
  distance?: number;
  variationIndex?: number;
}

export function generateNameVariations(inventor: InventorName): string[] {
  const first = inventor.firstName.trim();
  const last = inventor.lastName.trim();
  const middle = inventor.middleName?.trim() ?? '';

  return [
    `${last} ${first}`,
    `${first} ${last}`,
    middle ? `${last} ${first} ${middle}` : `${last} ${first}`,
    middle ? `${first} ${middle} ${last}` : `${first} ${last}`,
    last,
    first,
  ].map((v) => v.trim());
}

export function matchInventorToAssignor(
  inventor: InventorName,
  assignorName: string,
  threshold: number = 5
): InventorMatchResult {
  const variations = generateNameVariations(inventor);
  const normalizedAssignor = assignorName.trim().toLowerCase();

  for (let i = 0; i < variations.length; i++) {
    const normalizedVariation = variations[i].toLowerCase();
    const distance = levenshteinDistance(normalizedVariation, normalizedAssignor);

    if (distance < threshold) {
      return {
        matched: true,
        matchedVariation: variations[i],
        distance,
        variationIndex: i,
      };
    }
  }

  return { matched: false };
}

export function matchInventorsToAssignment(
  inventors: InventorName[],
  assignorNames: string[],
  threshold: number = 5
): {
  isEmployerAssignment: boolean;
  matchedInventor?: InventorName;
  matchedAssignor?: string;
  details?: InventorMatchResult;
} {
  for (const inventor of inventors) {
    for (const assignorName of assignorNames) {
      const result = matchInventorToAssignor(inventor, assignorName, threshold);
      if (result.matched) {
        return {
          isEmployerAssignment: true,
          matchedInventor: inventor,
          matchedAssignor: assignorName,
          details: result,
        };
      }
    }
  }

  return { isEmployerAssignment: false };
}
