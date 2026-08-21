import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @typedef {Object} JsonSchema
 * @property {string | string[]} [type]
 * @property {unknown[]} [enum]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {string} [pattern]
 * @property {Record<string, JsonSchema>} [properties]
 * @property {string[]} [required]
 * @property {JsonSchema} [items]
 * @property {JsonSchema[]} [oneOf]
 * @property {JsonSchema[]} [anyOf]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [version]
 */

/**
 * Validates data against a simple JSON schema
 * Supports type, required, properties, items, enum, minimum, maximum, pattern
 *
 * @param {JsonSchema} schema
 * @param {unknown} data
 * @param {string} [dataPath]
 * @returns {string[]}
 */
function validateSchemaNode(schema, data, dataPath = 'metadata') {
  /** @type {string[]} */
  const errors = [];

  if (schema === undefined || schema === null) return errors;
  if (data === undefined) return errors; // Missing data is handled by 'required' check in parent

  // Check type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    let typeValid = false;
    for (const t of types) {
      if (t === 'string' && typeof data === 'string') typeValid = true;
      else if (t === 'number' && typeof data === 'number') typeValid = true;
      else if (t === 'integer' && typeof data === 'number' && Number.isInteger(data)) typeValid = true;
      else if (t === 'boolean' && typeof data === 'boolean') typeValid = true;
      else if (t === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) typeValid = true;
      else if (t === 'array' && Array.isArray(data)) typeValid = true;
      else if (t === 'null' && data === null) typeValid = true;
    }
    if (!typeValid) {
      errors.push(`${dataPath} must be of type ${types.join(' or ')}`);
      return errors; // Stop validating deeper if type is wrong
    }
  }

  // Check enum
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${dataPath} must be one of [${schema.enum.join(', ')}]`);
  }

  // Number checks
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${dataPath} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${dataPath} must be <= ${schema.maximum}`);
    }
  }

  // String checks
  if (typeof data === 'string') {
    if (schema.pattern) {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push(`${dataPath} must match pattern ${schema.pattern}`);
        }
      } catch (e) {
        errors.push(`${dataPath} has invalid regex pattern in schema`);
      }
    }
  }

  // Object checks
  if (schema.type === 'object' || schema.properties) {
    if (data === null || (typeof data !== 'object' && typeof data !== 'undefined')) {
      errors.push(`${dataPath} must be an object`);
      return errors;
    }
    const record = /** @type {Record<string, unknown>} */ (data);
    if (schema.required && Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (record[req] === undefined) {
          errors.push(`${dataPath}.${req} is required`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (record[key] !== undefined) {
          errors.push(...validateSchemaNode(propSchema, record[key], `${dataPath}.${key}`));
        }
      }
    }
  }

  // Array checks
  if ((schema.type === 'array' || schema.items) && Array.isArray(data)) {
    const dataArray = /** @type {unknown[]} */ (data);
    if (schema.items) {
      for (let i = 0; i < dataArray.length; i++) {
        errors.push(...validateSchemaNode(schema.items, dataArray[i], `${dataPath}[${i}]`));
      }
    }
  }

  // oneOf checks
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    let validCount = 0;
    for (const subSchema of schema.oneOf) {
      const subErrors = validateSchemaNode(subSchema, data, dataPath);
      if (subErrors.length === 0) validCount++;
    }
    if (validCount !== 1) {
      errors.push(`${dataPath} must match exactly one of the schemas in oneOf`);
    }
  }

  // anyOf checks
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    let anyValid = false;
    for (const subSchema of schema.anyOf) {
      const subErrors = validateSchemaNode(subSchema, data, dataPath);
      if (subErrors.length === 0) {
        anyValid = true;
        break;
      }
    }
    if (!anyValid) {
      errors.push(`${dataPath} must match at least one of the schemas in anyOf`);
    }
  }

  return errors;
}

class MetadataSchemaRegistry {
  constructor() {
    /** @type {Map<string, JsonSchema>} */
    this.schemas = new Map();
  }

  /**
   * Register a JSON schema for a specific platform and category
   *
   * @param {string} platform
   * @param {string} category
   * @param {JsonSchema} schema
   * @returns {void}
   */
  registerSchema(platform, category, schema) {
    if (!platform || !category || !schema) {
      throw new Error('platform, category, and schema are required');
    }
    const key = `${platform}:${category}`;
    this.schemas.set(key, schema);
  }

  /**
   * Get a registered JSON schema
   *
   * @param {string} platform
   * @param {string} category
   * @returns {JsonSchema | null}
   */
  getSchema(platform, category) {
    const key = `${platform}:${category}`;
    return this.schemas.get(key) || null;
  }

  /**
   * Check if a schema is registered
   *
   * @param {string} platform
   * @param {string} category
   * @returns {boolean}
   */
  hasSchema(platform, category) {
    const key = `${platform}:${category}`;
    return this.schemas.has(key);
  }

  /**
   * Recursively discover and register all .json files in a directory
   *
   * @param {string} schemasDir
   * @returns {void}
   */
  loadSchemasFromDisk(schemasDir) {
    if (!fs.existsSync(schemasDir) || !fs.statSync(schemasDir).isDirectory()) return;

    const platforms = fs.readdirSync(schemasDir, { withFileTypes: true });

    for (const platformDirent of platforms) {
      if (!platformDirent.isDirectory()) continue;
      
      const platform = platformDirent.name;
      const platformPath = path.join(schemasDir, platform);
      const schemaFiles = fs.readdirSync(platformPath, { withFileTypes: true });
      
      for (const fileDirent of schemaFiles) {
        if (!fileDirent.isFile() || !fileDirent.name.endsWith('.json')) continue;
        
        const category = path.basename(fileDirent.name, '.json');
        const schemaPath = path.join(platformPath, fileDirent.name);
        
        try {
          const content = fs.readFileSync(schemaPath, 'utf8');
          const schema = /** @type {JsonSchema} */ (JSON.parse(content));
          this.registerSchema(platform, category, schema);
        } catch (error) {
          console.error(`Failed to load schema from ${schemaPath}:`, error);
        }
      }
    }
  }

  /**
   * List all available schemas
   *
   * @returns {Array<{ platform: string, category: string, title: string, description: string, version: string, propertiesCount: number }>}
   */
  listSchemas() {
    /** @type {Array<{ platform: string, category: string, title: string, description: string, version: string, propertiesCount: number }>} */
    const result = [];
    for (const [key, schema] of this.schemas.entries()) {
      const [platform, category] = key.split(':');
      let propertiesCount = 0;
      if (schema.properties) {
        propertiesCount = Object.keys(schema.properties).length;
      }
      
      result.push({
        platform,
        category,
        title: schema.title || '',
        description: schema.description || '',
        version: schema.version || '',
        propertiesCount
      });
    }
    return result;
  }

  /**
   * Validate a metadata object against the registered schema
   *
   * @param {string} platform
   * @param {string} category
   * @param {unknown} metadata
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateMetadata(platform, category, metadata) {
    const schema = this.getSchema(platform, category);
    
    if (!schema) {
      // If no schema registered, we consider it valid (unbounded fallback)
      return { valid: true, errors: [] };
    }

    // Metadata is optional: null/undefined should not trigger validation
    if (metadata === null || metadata === undefined) {
      return { valid: true, errors: [] };
    }

    // If the schema explicitly expects an object, reject non-object/array data early
    if (schema.type === 'object' && (typeof metadata !== 'object' || Array.isArray(metadata))) {
      return { valid: false, errors: ['metadata must be of type object'] };
    }

    const errors = validateSchemaNode(schema, metadata, 'metadata');
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

const metadataSchemaRegistry = new MetadataSchemaRegistry();

// Auto-load schemas/ directory on module load
const defaultSchemasDir = path.resolve(__dirname, '../../schemas');
try {
  metadataSchemaRegistry.loadSchemasFromDisk(defaultSchemasDir);
} catch (error) {
  // Ignore missing directory during initialization (e.g., in some test environments)
}

export default metadataSchemaRegistry;
