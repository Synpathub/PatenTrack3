import { describe, it, expect } from 'vitest';
import { classifyConveyance, classifyBatch, isOwnershipTransfer, isEncumbrance, isRelease } from '../classify';

describe('classifyConveyance', () => {
  describe('Priority 1: Corrections', () => {
    it('classifies "CORRECTIVE ASSIGNMENT" as correct, not assignment', () => {
      const result = classifyConveyance('CORRECTIVE ASSIGNMENT');
      expect(result.conveyType).toBe('correct');
      expect(result.employerAssign).toBe(false);
    });

    it('classifies "RE-RECORD TO CORRECT" as correct', () => {
      expect(classifyConveyance('RE-RECORD TO CORRECT THE EXECUTION DATE').conveyType).toBe('correct');
    });

    it('is case-insensitive', () => {
      expect(classifyConveyance('Corrective Assignment').conveyType).toBe('correct');
      expect(classifyConveyance('re-record').conveyType).toBe('correct');
    });
  });

  describe('Priority 2: Employee Assignments', () => {
    it('classifies "EMPLOYEE AGREEMENT" as employee with employerAssign=true', () => {
      const result = classifyConveyance('EMPLOYEE AGREEMENT');
      expect(result.conveyType).toBe('employee');
      expect(result.employerAssign).toBe(true);
    });

    it('classifies "EMPLOYMENT AGREEMENT" as employee', () => {
      expect(classifyConveyance('EMPLOYMENT AGREEMENT').conveyType).toBe('employee');
    });
  });

  describe('Priority 3-9: Other types', () => {
    it('classifies "CONFIRMATORY ASSIGNMENT" as govern', () => {
      expect(classifyConveyance('CONFIRMATORY ASSIGNMENT').conveyType).toBe('govern');
    });

    it('classifies "MERGER" as merger', () => {
      expect(classifyConveyance('MERGER').conveyType).toBe('merger');
    });

    it('classifies "CHANGE OF NAME" as namechg', () => {
      expect(classifyConveyance('CHANGE OF NAME').conveyType).toBe('namechg');
    });

    it('classifies "LICENSE AGREEMENT" as license', () => {
      expect(classifyConveyance('LICENSE AGREEMENT').conveyType).toBe('license');
    });

    it('classifies "RELEASE BY SECURED PARTY" as release', () => {
      expect(classifyConveyance('RELEASE BY SECURED PARTY').conveyType).toBe('release');
    });

    it('classifies "SECURITY AGREEMENT" as security', () => {
      expect(classifyConveyance('SECURITY AGREEMENT').conveyType).toBe('security');
    });

    it('classifies "ASSIGNMENT OF ASSIGNORS INTEREST" as assignment', () => {
      expect(classifyConveyance('ASSIGNMENT OF ASSIGNORS INTEREST').conveyType).toBe('assignment');
    });
  });

  describe('Priority Order (first match wins)', () => {
    it('"CORRECTIVE ASSIGNMENT" -> correct (not assignment)', () => {
      expect(classifyConveyance('CORRECTIVE ASSIGNMENT').conveyType).toBe('correct');
    });

    it('"EMPLOYEE ASSIGNMENT" -> employee (not assignment)', () => {
      expect(classifyConveyance('EMPLOYEE ASSIGNMENT').conveyType).toBe('employee');
    });

    it('"RELEASE OF SECURITY INTEREST" -> release (not security)', () => {
      expect(classifyConveyance('RELEASE OF SECURITY INTEREST').conveyType).toBe('release');
    });

    it('"MERGER AND CHANGE OF NAME" -> merger (not namechg)', () => {
      expect(classifyConveyance('MERGER AND CHANGE OF NAME').conveyType).toBe('merger');
    });
  });

  describe('Default: Missing', () => {
    it('classifies unknown text as missing', () => {
      expect(classifyConveyance('SOME RANDOM TEXT').conveyType).toBe('missing');
    });

    it('classifies empty string as missing', () => {
      expect(classifyConveyance('').conveyType).toBe('missing');
    });
  });
});

describe('classifyBatch', () => {
  it('classifies multiple items', () => {
    const results = classifyBatch([
      { rfId: '12345-001', conveyText: 'ASSIGNMENT' },
      { rfId: '12345-002', conveyText: 'SECURITY AGREEMENT' },
      { rfId: '12345-003', conveyText: 'UNKNOWN TEXT' },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].conveyType).toBe('assignment');
    expect(results[1].conveyType).toBe('security');
    expect(results[2].conveyType).toBe('missing');
  });
});

describe('helper functions', () => {
  it('isOwnershipTransfer returns true for ownership types', () => {
    expect(isOwnershipTransfer('assignment')).toBe(true);
    expect(isOwnershipTransfer('employee')).toBe(true);
    expect(isOwnershipTransfer('security')).toBe(false);
    expect(isOwnershipTransfer('license')).toBe(false);
  });

  it('isEncumbrance/isRelease', () => {
    expect(isEncumbrance('security')).toBe(true);
    expect(isEncumbrance('assignment')).toBe(false);
    expect(isRelease('release')).toBe(true);
    expect(isRelease('security')).toBe(false);
  });
});
