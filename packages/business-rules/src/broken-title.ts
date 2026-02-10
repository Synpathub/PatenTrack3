/**
 * Broken title chain detection (BR-032 through BR-036)
 *
 * Detects patents with broken ownership chains — one of PatenTrack's
 * core value propositions.
 */

export interface BrokenTitleResult {
  isBroken: boolean;
  reason?: 'no_assignments' | 'no_inventor_link' | 'chain_break' | 'no_employee_start';
  missingLink?: { from: string; to: string };
  breakPoint?: number;
}

export interface AssignmentChainLink {
  rfId: string;
  assignors: Array<{ name: string }>;
  assignees: Array<{ name: string }>;
  isEmployerAssignment: boolean;
  recordDate: Date;
}

/**
 * Compute Levenshtein distance between two strings.
 * Used for fuzzy name matching in chain continuity checks.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,       // deletion
        dp[i]![j - 1]! + 1,       // insertion
        dp[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Check if two names are similar enough to be the same entity.
 * Threshold of 3 matches legacy behavior.
 */
function namesMatch(a: string, b: string, threshold = 3): boolean {
  return levenshteinDistance(a.toUpperCase(), b.toUpperCase()) <= threshold;
}

/**
 * Detect whether a patent has a broken title chain.
 *
 * BR-032: A title is "broken" if there's no continuous chain from inventor to current owner
 * BR-033: Chain continuity = each assignee in step N must appear as assignor in step N+1
 * BR-034: Employee assignments count as chain starters (inventor → employer)
 * BR-035: Chain WITHOUT employee assignment at start must have inventor as first assignor
 * BR-036: Levenshtein distance ≤ 3 for fuzzy name matching
 */
export function detectBrokenTitle(
  assignments: AssignmentChainLink[],
  inventors: string[],
): BrokenTitleResult {
  if (assignments.length === 0) {
    return { isBroken: true, reason: 'no_assignments' };
  }

  // Sort by date
  const sorted = [...assignments].sort(
    (a, b) => new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime(),
  );

  const first = sorted[0]!;

  // BR-034: Check for employee assignment as first link
  if (!first.isEmployerAssignment) {
    // BR-035: No employee assignment — check if any assignor is an inventor
    const firstAssignors = first.assignors.map((a) => a.name);
    const hasInventorLink = firstAssignors.some((assignor) =>
      inventors.some((inv) => namesMatch(assignor, inv)),
    );

    if (!hasInventorLink) {
      return {
        isBroken: true,
        reason: 'no_inventor_link',
        missingLink: {
          from: inventors[0] || 'Unknown Inventor',
          to: first.assignors[0]?.name || 'Unknown',
        },
      };
    }
  }

  // BR-033: Check chain continuity
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentAssignees = sorted[i]!.assignees.map((a) => a.name);
    const nextAssignors = sorted[i + 1]!.assignors.map((a) => a.name);

    const hasLink = currentAssignees.some((assignee) =>
      nextAssignors.some((assignor) => namesMatch(assignee, assignor)),
    );

    if (!hasLink) {
      return {
        isBroken: true,
        reason: 'chain_break',
        missingLink: {
          from: sorted[i]!.assignees[0]?.name || 'Unknown',
          to: sorted[i + 1]!.assignors[0]?.name || 'Unknown',
        },
        breakPoint: i + 1,
      };
    }
  }

  return { isBroken: false };
}
