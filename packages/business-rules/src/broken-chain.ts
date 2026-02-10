/**
 * Broken Title Chain Detection
 *
 * THIS IS THE CORE BUSINESS LOGIC OF PATENTRACK.
 *
 * Source: broken_title.php
 * Business Rules: BR-032 through BR-036
 */

import { CONVEYANCE_TYPES, type ConveyanceType, DASHBOARD_TYPES } from '@patentrack/shared';
import { levenshteinDistance } from './normalize';

export interface ChainTransaction {
  rfId: string;
  assignorNames: string[];
  assigneeNames: string[];
  conveyanceType: ConveyanceType;
  employerAssign: boolean;
  recordDate: Date;
}

export interface ChainBreak {
  transactionIndex: number;
  beforeRfId: string;
  afterRfId: string;
  expectedAssignor: string[];
  actualAssignor: string[];
  reason: string;
}

export interface ChainAnalysis {
  status: 'complete' | 'broken' | 'encumbered' | 'no-transactions';
  dashboardType: number;
  hasEmployeeStart: boolean;
  hasUnreleasedSecurity: boolean;
  breaks: ChainBreak[];
  transactionCount: number;
  activeSecurityInterests: string[];
}

const CHAIN_NAME_MATCH_THRESHOLD = 5;

function namesMatch(nameA: string, nameB: string): boolean {
  return levenshteinDistance(
    nameA.toLowerCase().trim(),
    nameB.toLowerCase().trim()
  ) < CHAIN_NAME_MATCH_THRESHOLD;
}

function anyNameMatches(listA: string[], listB: string[]): boolean {
  for (const a of listA) {
    for (const b of listB) {
      if (namesMatch(a, b)) return true;
    }
  }
  return false;
}

export function analyzeChain(transactions: ChainTransaction[]): ChainAnalysis {
  if (transactions.length === 0) {
    return {
      status: 'no-transactions',
      dashboardType: DASHBOARD_TYPES.BROKEN,
      hasEmployeeStart: false,
      hasUnreleasedSecurity: false,
      breaks: [],
      transactionCount: 0,
      activeSecurityInterests: [],
    };
  }

  const ownershipTransactions = transactions.filter(
    (t) =>
      t.conveyanceType !== CONVEYANCE_TYPES.SECURITY &&
      t.conveyanceType !== CONVEYANCE_TYPES.RELEASE &&
      t.conveyanceType !== CONVEYANCE_TYPES.LICENSE
  );

  const securityTransactions = transactions.filter(
    (t) => t.conveyanceType === CONVEYANCE_TYPES.SECURITY
  );

  const releaseTransactions = transactions.filter(
    (t) => t.conveyanceType === CONVEYANCE_TYPES.RELEASE
  );

  const activeSecurityInterests = findUnreleasedSecurityInterests(
    securityTransactions,
    releaseTransactions
  );
  const hasUnreleasedSecurity = activeSecurityInterests.length > 0;

  if (ownershipTransactions.length === 0) {
    return {
      status: hasUnreleasedSecurity ? 'encumbered' : 'no-transactions',
      dashboardType: hasUnreleasedSecurity
        ? DASHBOARD_TYPES.ENCUMBERED
        : DASHBOARD_TYPES.BROKEN,
      hasEmployeeStart: false,
      hasUnreleasedSecurity,
      breaks: [],
      transactionCount: 0,
      activeSecurityInterests,
    };
  }

  const firstTransaction = ownershipTransactions[0];
  const hasEmployeeStart = firstTransaction.employerAssign;

  const breaks: ChainBreak[] = [];

  for (let i = 0; i < ownershipTransactions.length - 1; i++) {
    const current = ownershipTransactions[i];
    const next = ownershipTransactions[i + 1];


    if (!anyNameMatches(current.assigneeNames, next.assignorNames)) {
      breaks.push({
        transactionIndex: i + 1,
        beforeRfId: current.rfId,
        afterRfId: next.rfId,
        expectedAssignor: current.assigneeNames,
        actualAssignor: next.assignorNames,
        reason: `Chain break: assignee "${current.assigneeNames.join(', ')}" of ${current.rfId} does not match assignor "${next.assignorNames.join(', ')}" of ${next.rfId}`,
      });
    }
  }

  const hasBrokenLinks = breaks.length > 0;
  const missingEmployeeStart = !hasEmployeeStart && !hasBrokenLinks;

  if (hasUnreleasedSecurity && !hasBrokenLinks && !missingEmployeeStart) {
    return {
      status: 'encumbered',
      dashboardType: DASHBOARD_TYPES.ENCUMBERED,
      hasEmployeeStart,
      hasUnreleasedSecurity,
      breaks: [],
      transactionCount: ownershipTransactions.length,
      activeSecurityInterests,
    };
  }

  if (hasBrokenLinks || missingEmployeeStart) {
    return {
      status: 'broken',
      dashboardType: DASHBOARD_TYPES.BROKEN,
      hasEmployeeStart,
      hasUnreleasedSecurity,
      breaks: missingEmployeeStart
        ? [
            {
              transactionIndex: 0,
              beforeRfId: '',
              afterRfId: firstTransaction.rfId,
              expectedAssignor: ['(inventor)'],
              actualAssignor: firstTransaction.assignorNames,
              reason: 'Chain does not start with an employee/inventor assignment',
            },
            ...breaks,
          ]
        : breaks,
      transactionCount: ownershipTransactions.length,
      activeSecurityInterests,
    };
  }

  return {
    status: 'complete',
    dashboardType: DASHBOARD_TYPES.COMPLETE,
    hasEmployeeStart,
    hasUnreleasedSecurity: false,
    breaks: [],
    transactionCount: ownershipTransactions.length,
    activeSecurityInterests: [],
  };
}

function findUnreleasedSecurityInterests(
  securities: ChainTransaction[],
  releases: ChainTransaction[]
): string[] {
  const unreleased: string[] = [];

  for (const security of securities) {
    const isReleased = releases.some((release) =>
      anyNameMatches(security.assigneeNames, release.assignorNames)
    );

    if (!isReleased) {
      unreleased.push(security.rfId);
    }
  }

  return unreleased;
}
