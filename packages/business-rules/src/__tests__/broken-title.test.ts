import { describe, it, expect } from 'vitest';
import { detectBrokenTitle, levenshteinDistance } from '../broken-title.js';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('ACME INC', 'ACME INC')).toBe(0);
  });

  it('handles simple edits', () => {
    expect(levenshteinDistance('ACME INC', 'ACME INC.')).toBe(1);
  });

  it('handles name variations within threshold', () => {
    expect(levenshteinDistance('ACME CORP', 'ACME CORPORATION')).toBeLessThanOrEqual(7);
    expect(levenshteinDistance('ACME INC', 'ACME INC.')).toBeLessThanOrEqual(3);
  });
});

describe('detectBrokenTitle', () => {
  it('BR-032: detects broken title with no assignments', () => {
    const result = detectBrokenTitle([], ['John Inventor']);
    expect(result.isBroken).toBe(true);
    expect(result.reason).toBe('no_assignments');
  });

  it('BR-034: accepts employee assignment as chain start', () => {
    const result = detectBrokenTitle(
      [
        {
          rfId: '001/001',
          assignors: [{ name: 'John Inventor' }],
          assignees: [{ name: 'Acme Corp' }],
          isEmployerAssignment: true,
          recordDate: new Date('2020-01-01'),
        },
      ],
      ['John Inventor'],
    );
    expect(result.isBroken).toBe(false);
  });

  it('BR-035: detects missing inventor link without employee start', () => {
    const result = detectBrokenTitle(
      [
        {
          rfId: '001/001',
          assignors: [{ name: 'Unknown Person' }],
          assignees: [{ name: 'Acme Corp' }],
          isEmployerAssignment: false,
          recordDate: new Date('2020-01-01'),
        },
      ],
      ['John Inventor'],
    );
    expect(result.isBroken).toBe(true);
    expect(result.reason).toBe('no_inventor_link');
  });

  it('BR-033: detects chain break between assignments', () => {
    const result = detectBrokenTitle(
      [
        {
          rfId: '001/001',
          assignors: [{ name: 'John Inventor' }],
          assignees: [{ name: 'Acme Corp' }],
          isEmployerAssignment: false,
          recordDate: new Date('2020-01-01'),
        },
        {
          rfId: '002/001',
          assignors: [{ name: 'Totally Different Entity' }],
          assignees: [{ name: 'New Owner Inc' }],
          isEmployerAssignment: false,
          recordDate: new Date('2021-01-01'),
        },
      ],
      ['John Inventor'],
    );
    expect(result.isBroken).toBe(true);
    expect(result.reason).toBe('chain_break');
    expect(result.breakPoint).toBe(1);
  });

  it('BR-033: accepts continuous chain', () => {
    const result = detectBrokenTitle(
      [
        {
          rfId: '001/001',
          assignors: [{ name: 'John Inventor' }],
          assignees: [{ name: 'Acme Corp' }],
          isEmployerAssignment: false,
          recordDate: new Date('2020-01-01'),
        },
        {
          rfId: '002/001',
          assignors: [{ name: 'Acme Corp' }],
          assignees: [{ name: 'New Owner Inc' }],
          isEmployerAssignment: false,
          recordDate: new Date('2021-01-01'),
        },
      ],
      ['John Inventor'],
    );
    expect(result.isBroken).toBe(false);
  });

  it('BR-036: uses fuzzy matching for name variations', () => {
    const result = detectBrokenTitle(
      [
        {
          rfId: '001/001',
          assignors: [{ name: 'John Inventor' }],
          assignees: [{ name: 'ACME CORP' }],
          isEmployerAssignment: false,
          recordDate: new Date('2020-01-01'),
        },
        {
          rfId: '002/001',
          assignors: [{ name: 'ACME CORP.' }], // trailing period — Levenshtein 1
          assignees: [{ name: 'New Owner' }],
          isEmployerAssignment: false,
          recordDate: new Date('2021-01-01'),
        },
      ],
      ['John Inventor'],
    );
    expect(result.isBroken).toBe(false); // Should pass — names close enough
  });
});
