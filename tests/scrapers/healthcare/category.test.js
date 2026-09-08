import { describe, it, expect } from 'vitest';
import { isValidCategory, CATEGORIES } from '../../../src/core/types.js';

describe('healthcare category', () => {
  it('should accept healthcare as valid category', () => {
    expect(isValidCategory('healthcare')).toBe(true);
    expect(CATEGORIES.HEALTHCARE).toBe('healthcare');
  });
});
