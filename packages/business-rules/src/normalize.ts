/**
 * Entity Name Normalization
 *
 * Source: normalize_file.php, normalize_names.js
 * Business Rules: BR-013 through BR-020
 */

import {
  SUFFIX_REPLACEMENTS,
  DEFAULT_LEVENSHTEIN_THRESHOLD,
} from '@patentrack/shared';

export function normalizeName(name: string): string {
  if (!name || name.trim().length === 0) return '';

  let result = name.trim();

  for (const { trailing, replacement } of SUFFIX_REPLACEMENTS) {
    const lowerResult = result.toLowerCase();
    const lowerTrailing = trailing.toLowerCase();

    if (lowerResult.endsWith(lowerTrailing)) {
      result = result.slice(0, -trailing.length) + replacement;
      break;
    }
  }

  result = result.replace(/\s+/g, " ").trim();
  result = toTitleCase(result);
  return result;
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
}

export function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const matrix: number[][] = Array.from({ length: aLen + 1 }, (_, i) =>
    Array.from({ length: bLen + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[aLen][bLen];
}

export interface EntityCandidate {
  id: string | number;
  name: string;
  occurrenceCount: number;
}

export interface EntityGroup {
  canonicalName: string;
  canonicalId: string | number;
  memberIds: (string | number)[];
  names: string[];
}

export function groupEntities(
  entities: EntityCandidate[],
  threshold: number = DEFAULT_LEVENSHTEIN_THRESHOLD
): EntityGroup[] {
  if (entities.length === 0) return [];

  const sorted = [...entities].sort((a, b) => {
    const aWords = a.name.split(/\s+/).length;
    const bWords = b.name.split(/\s+/).length;
    return bWords - aWords;
  });

  const assigned = new Set<string | number>();
  const groups: EntityGroup[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(sorted[i].id)) continue;

    const group: EntityGroup = {
      canonicalName: sorted[i].name,
      canonicalId: sorted[i].id,
      memberIds: [sorted[i].id],
      names: [sorted[i].name],
    };
    let maxCount = sorted[i].occurrenceCount;
    assigned.add(sorted[i].id);

    for (let j = i + 1; j < sorted.length; j++) {
      if (assigned.has(sorted[j].id)) continue;

      const distance = levenshteinDistance(
        sorted[i].name.toLowerCase(),
        sorted[j].name.toLowerCase()
      );

      if (distance < threshold) {
        group.memberIds.push(sorted[j].id);
        group.names.push(sorted[j].name);
        assigned.add(sorted[j].id);

        if (sorted[j].occurrenceCount > maxCount) {
          maxCount = sorted[j].occurrenceCount;
          group.canonicalName = sorted[j].name;
          group.canonicalId = sorted[j].id;
        }
      }
    }

    groups.push(group);
  }

  return groups;
}
