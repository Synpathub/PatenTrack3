import { describe, it, expect } from 'vitest';
import { generateNameVariations, matchInventorToAssignor, matchInventorsToAssignment } from '../inventor-match';

describe('generateNameVariations', () => {
  it('generates 6 variations with middle name', () => {
    const v = generateNameVariations({ firstName: 'John', lastName: 'Smith', middleName: 'William' });
    expect(v).toHaveLength(6);
    expect(v[0]).toBe('Smith John');
    expect(v[1]).toBe('John Smith');
    expect(v[2]).toBe('Smith John William');
    expect(v[3]).toBe('John William Smith');
    expect(v[4]).toBe('Smith');
    expect(v[5]).toBe('John');
  });

  it('generates 6 variations without middle name', () => {
    const v = generateNameVariations({ firstName: 'Jane', lastName: 'Doe' });
    expect(v).toHaveLength(6);
    expect(v[0]).toBe('Doe Jane');
    expect(v[1]).toBe('Jane Doe');
  });
});

describe('matchInventorToAssignor', () => {
  it('matches exact name', () => {
    const result = matchInventorToAssignor({ firstName: 'John', lastName: 'Smith' }, 'John Smith');
    expect(result.matched).toBe(true);
    expect(result.distance).toBe(0);
  });

  it('matches with slight variation', () => {
    const result = matchInventorToAssignor({ firstName: 'John', lastName: 'Smith' }, 'Smith, John');
    expect(result.matched).toBe(true);
  });

  it('does not match completely different names', () => {
    const result = matchInventorToAssignor({ firstName: 'John', lastName: 'Smith' }, 'Acme Corporation');
    expect(result.matched).toBe(false);
  });

  it('is case-insensitive', () => {
    const result = matchInventorToAssignor({ firstName: 'JOHN', lastName: 'SMITH' }, 'john smith');
    expect(result.matched).toBe(true);
  });
});

describe('matchInventorsToAssignment', () => {
  it('returns true when any inventor matches any assignor', () => {
    const result = matchInventorsToAssignment(
      [{ firstName: 'John', lastName: 'Smith' }, { firstName: 'Jane', lastName: 'Doe' }],
      ['Acme Corporation', 'John Smith']
    );
    expect(result.isEmployerAssignment).toBe(true);
    expect(result.matchedInventor!.lastName).toBe('Smith');
  });

  it('returns false when no match', () => {
    const result = matchInventorsToAssignment(
      [{ firstName: 'John', lastName: 'Smith' }],
      ['Acme Corporation', 'TechVentures LLC']
    );
    expect(result.isEmployerAssignment).toBe(false);
  });
});
