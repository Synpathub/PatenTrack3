import { describe, it, expect } from 'vitest';
import { normalizeName, levenshteinDistance, groupEntities } from '../normalize';

describe('normalizeName', () => {
  it('normalizes "MICROSOFT CORPORATION" to "Microsoft Corp"', () => {
    expect(normalizeName('MICROSOFT CORPORATION')).toBe('Microsoft Corp');
  });

  it('normalizes "APPLE INCORPORATED" to "Apple Inc"', () => {
    expect(normalizeName('APPLE INCORPORATED')).toBe('Apple Inc');
  });

  it('normalizes "GOOGLE LIMITED" to "Google Ltd"', () => {
    expect(normalizeName('GOOGLE LIMITED')).toBe('Google Ltd');
  });

  it('normalizes "AMAZON COMPANY" to "Amazon Co"', () => {
    expect(normalizeName('AMAZON COMPANY')).toBe('Amazon Co');
  });

  it('applies title case when no suffix matches', () => {
    expect(normalizeName('JOHN SMITH')).toBe('John Smith');
  });

  it('does not replace suffix if not trailing', () => {
    expect(normalizeName('CORPORATION OF AMERICA')).toBe('Corporation Of America');
  });

  it('handles empty string', () => {
    expect(normalizeName('')).toBe('');
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns length for empty string', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('calculates single character difference', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('calculates multiple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('groupEntities', () => {
  it('groups similar names together', () => {
    const groups = groupEntities([
      { id: 1, name: 'Microsoft Corp', occurrenceCount: 500 },
      { id: 2, name: 'Microsoft Co', occurrenceCount: 3 },
      { id: 3, name: 'Apple Inc', occurrenceCount: 200 },
    ]);
    expect(groups).toHaveLength(2);
    const msGroup = groups.find((g) => g.canonicalName === 'Microsoft Corp');
    expect(msGroup!.memberIds).toContain(1);
    expect(msGroup!.memberIds).toContain(2);
  });

  it('selects canonical name by highest occurrence count', () => {
    const groups = groupEntities([
      { id: 1, name: 'Microsft Corp', occurrenceCount: 3 },
      { id: 2, name: 'Microsoft Corp', occurrenceCount: 500 },
    ]);
    expect(groups[0].canonicalName).toBe('Microsoft Corp');
  });

  it('handles empty input', () => {
    expect(groupEntities([])).toEqual([]);
  });
});
