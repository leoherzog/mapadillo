import { describe, it, expect } from 'vitest';
import { isSandbox } from './prodigi.js';

describe('isSandbox', () => {
  it('returns false for undefined / null / empty string', () => {
    expect(isSandbox(undefined)).toBe(false);
    expect(isSandbox(null)).toBe(false);
    expect(isSandbox('')).toBe(false);
  });

  it('returns true for common truthy spellings', () => {
    for (const v of ['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on']) {
      expect(isSandbox(v)).toBe(true);
    }
  });

  it('trims whitespace before matching', () => {
    expect(isSandbox('  true  ')).toBe(true);
    expect(isSandbox('\ttrue\n')).toBe(true);
  });

  it('returns false for anything else', () => {
    for (const v of ['false', 'no', '0', 'off', 'sandbox', 'live']) {
      expect(isSandbox(v)).toBe(false);
    }
  });

  it('passes booleans through unchanged', () => {
    expect(isSandbox(true)).toBe(true);
    expect(isSandbox(false)).toBe(false);
  });
});
