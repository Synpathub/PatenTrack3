import { describe, it, expect } from 'vitest';
import { analyzeChain, type ChainTransaction } from '../broken-chain';

function txn(
  overrides: Partial<ChainTransaction> & Pick<ChainTransaction, 'assignorNames' | 'assigneeNames'>
): ChainTransaction {
  return {
    rfId: overrides.rfId ?? `${Math.random().toString(36).slice(2)}-0001`,
    conveyanceType: overrides.conveyanceType ?? 'assignment',
    employerAssign: overrides.employerAssign ?? false,
    recordDate: overrides.recordDate ?? new Date('2020-01-01'),
    ...overrides,
  };
}

describe('analyzeChain', () => {
  describe('Complete chains', () => {
    it('recognizes inventor -> employer -> buyer as complete', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['John Smith'], assigneeNames: ['Acme Corp'], conveyanceType: 'employee', employerAssign: true, recordDate: new Date('2020-01-01') }),
        txn({ assignorNames: ['Acme Corp'], assigneeNames: ['TechVentures'], conveyanceType: 'assignment', recordDate: new Date('2021-06-15') }),
      ]);
      expect(result.status).toBe('complete');
      expect(result.dashboardType).toBe(0);
      expect(result.hasEmployeeStart).toBe(true);
      expect(result.breaks).toHaveLength(0);
    });
  });

  describe('Broken chains', () => {
    it('detects gap in ownership', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['Inventor'], assigneeNames: ['Acme Corp'], conveyanceType: 'employee', employerAssign: true, recordDate: new Date('2020-01-01') }),
        txn({ assignorNames: ['Unknown Corp'], assigneeNames: ['TechVentures'], conveyanceType: 'assignment', recordDate: new Date('2021-06-15') }),
      ]);
      expect(result.status).toBe('broken');
      expect(result.dashboardType).toBe(1);
      expect(result.breaks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Missing employee start (BR-035)', () => {
    it('marks chain as broken without employee start', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['Acme Corp'], assigneeNames: ['TechVentures'], conveyanceType: 'assignment', recordDate: new Date('2020-01-01') }),
      ]);
      expect(result.status).toBe('broken');
      expect(result.hasEmployeeStart).toBe(false);
    });
  });

  describe('Encumbrances', () => {
    it('detects unreleased security interest', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['Inventor'], assigneeNames: ['Acme Corp'], conveyanceType: 'employee', employerAssign: true, recordDate: new Date('2020-01-01') }),
        txn({ assignorNames: ['Acme Corp'], assigneeNames: ['Bank'], conveyanceType: 'security', recordDate: new Date('2021-01-01') }),
      ]);
      expect(result.status).toBe('encumbered');
      expect(result.hasUnreleasedSecurity).toBe(true);
    });

    it('clears encumbrance when released', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['Inventor'], assigneeNames: ['Acme Corp'], conveyanceType: 'employee', employerAssign: true, recordDate: new Date('2020-01-01') }),
        txn({ assignorNames: ['Acme Corp'], assigneeNames: ['Bank'], conveyanceType: 'security', recordDate: new Date('2021-01-01') }),
        txn({ assignorNames: ['Bank'], assigneeNames: ['Acme Corp'], conveyanceType: 'release', recordDate: new Date('2022-01-01') }),
      ]);
      expect(result.status).toBe('complete');
      expect(result.hasUnreleasedSecurity).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles no transactions', () => {
      expect(analyzeChain([]).status).toBe('no-transactions');
    });

    it('uses fuzzy name matching', () => {
      const result = analyzeChain([
        txn({ assignorNames: ['Inventor'], assigneeNames: ['Acme Corp'], conveyanceType: 'employee', employerAssign: true, recordDate: new Date('2020-01-01') }),
        txn({ assignorNames: ['Acme Corp.'], assigneeNames: ['TechVentures'], conveyanceType: 'assignment', recordDate: new Date('2021-01-01') }),
      ]);
      expect(result.status).toBe('complete');
    });
  });
});
