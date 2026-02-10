import { describe, it, expect } from 'vitest';
import { classifyConveyance } from '../classification.js';

describe('classifyConveyance', () => {
  it('BR-001: classifies standard assignments', () => {
    const result = classifyConveyance('ASSIGNMENT OF ASSIGNORS INTEREST (SEE DOCUMENT FOR DETAILS).');
    expect(result.type).toBe('assignment');
    expect(result.matchedRule).toBe('BR-001');
  });

  it('BR-002: classifies employee assignments', () => {
    const result = classifyConveyance('EMPLOYMENT AGREEMENT');
    expect(result.type).toBe('employee');
    expect(result.isEmployer).toBe(true);
    expect(result.matchedRule).toBe('BR-002');
  });

  it('BR-003: classifies government interest', () => {
    const result = classifyConveyance('CONFIRMATORY LICENSE (SEE DOCUMENT FOR DETAILS). GOVERNMENT INTEREST');
    expect(result.type).toBe('govern');
    expect(result.matchedRule).toBe('BR-003');
  });

  it('BR-004: classifies mergers', () => {
    const result = classifyConveyance('MERGER (SEE DOCUMENT FOR DETAILS).');
    expect(result.type).toBe('merger');
  });

  it('BR-005: classifies name changes', () => {
    const result = classifyConveyance('CHANGE OF NAME (SEE DOCUMENT FOR DETAILS).');
    expect(result.type).toBe('namechg');
  });

  it('BR-006: classifies licenses', () => {
    const result = classifyConveyance('EXCLUSIVE LICENSE AGREEMENT');
    expect(result.type).toBe('license');
  });

  it('BR-007: classifies releases', () => {
    const result = classifyConveyance('RELEASE BY SECURED PARTY (SEE DOCUMENT FOR DETAILS).');
    expect(result.type).toBe('release');
  });

  it('BR-008: classifies security interests', () => {
    const result = classifyConveyance('SECURITY INTEREST (SEE DOCUMENT FOR DETAILS).');
    expect(result.type).toBe('security');
  });

  it('BR-009: classifies corrections', () => {
    const result = classifyConveyance('CORRECTIVE ASSIGNMENT TO CORRECT THE ASSIGNEE');
    expect(result.type).toBe('correct');
  });

  it('BR-010: defaults to missing for unknown text', () => {
    const result = classifyConveyance('SOME UNKNOWN CONVEYANCE TYPE');
    expect(result.type).toBe('missing');
    expect(result.confidence).toBe(0.0);
  });

  it('prioritizes specific types over generic assignment', () => {
    // "SECURITY" should match before "ASSIGNMENT"
    const result = classifyConveyance('SECURITY INTEREST');
    expect(result.type).toBe('security');
  });
});
