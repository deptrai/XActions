import { describe, test, expect } from 'vitest';
import metadataSchemaRegistry from '../../src/core/metadata-schema-registry.js';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MetadataSchemaRegistry Service', () => {
  test('loadSchemasFromDisk should recursively discover and register .json files synchronously', () => {
    const schemasDir = path.resolve(__dirname, '../../schemas');
    metadataSchemaRegistry.loadSchemasFromDisk(schemasDir);
    const schemas = metadataSchemaRegistry.listSchemas();
    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas.some(s => s.platform === 'twitter' && s.category === 'social')).toBe(true);
  });

  test('registerSchema should cache schema in memory', () => {
    const dummySchema = { type: 'object', properties: { test: { type: 'string' } } };
    metadataSchemaRegistry.registerSchema('dummy', 'test', dummySchema);
    const retrieved = metadataSchemaRegistry.getSchema('dummy', 'test');
    expect(retrieved).toEqual(dummySchema);
  });

  test('getSchema should return null if not found', () => {
    expect(metadataSchemaRegistry.getSchema('unknown', 'unknown')).toBeNull();
  });

  test('hasSchema should return true if registered', () => {
    metadataSchemaRegistry.registerSchema('dummy', 'test2', {});
    expect(metadataSchemaRegistry.hasSchema('dummy', 'test2')).toBe(true);
    expect(metadataSchemaRegistry.hasSchema('unknown', 'unknown')).toBe(false);
  });

  test('validateMetadata should accumulate errors with exact JSON paths', () => {
    const dummySchema = { 
      type: 'object', 
      properties: { user: { type: 'object', properties: { age: { type: 'integer', minimum: 0 } } } } 
    };
    metadataSchemaRegistry.registerSchema('dummy', 'validate', dummySchema);
    
    const result = metadataSchemaRegistry.validateMetadata('dummy', 'validate', { user: { age: -5 } });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('user.age');
  });
});
