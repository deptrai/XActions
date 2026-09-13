// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * SchemaDriftGuard — Runtime Contract Validation & Completeness Classification.
 * Story 28.1.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { PlatformError, ErrorTypes, SuggestedActions } from './error-envelope.js';
import metadataSchemaRegistry, { validateSchemaNode } from './metadata-schema-registry.js';

/**
 * @typedef {'complete' | 'degraded' | 'corrupted'} DriftClassification
 */

/**
 * @typedef {Object} DriftValidationResult
 * @property {DriftClassification} classification
 * @property {number} score
 * @property {string[]} missingFields
 * @property {string[]} typeErrors
 */

export class SchemaDriftGuard {
  /**
   * @param {object} [deps]
   * @param {import('./metadata-schema-registry.js').MetadataSchemaRegistry} [deps.registry]
   */
  constructor(deps = {}) {
    this.registry = deps.registry || metadataSchemaRegistry;
    /** @type {Map<string, import('./metadata-schema-registry.js').JsonSchema>} */
    this.customSchemas = new Map();
  }

  /**
   * Register a custom item schema (e.g. for testing or platform override).
   * @param {string} type
   * @param {import('./metadata-schema-registry.js').JsonSchema} schema
   */
  registerItemSchema(type, schema) {
    if (!type || !schema) {
      throw new Error('type and schema are required');
    }
    this.customSchemas.set(type, schema);
  }

  /**
   * Resolve item schema following the priority:
   * 1. ${platform}:${schemaType} in custom schemas
   * 2. items:${schemaType} or ${schemaType} in custom schemas
   * 3. ${platform}:${schemaType} in registry
   * 4. items:${schemaType} in registry
   *
   * @param {string} platform
   * @param {string} schemaType
   * @returns {import('./metadata-schema-registry.js').JsonSchema | null}
   */
  getSchema(platform, schemaType) {
    if (platform && this.customSchemas.has(`${platform}:${schemaType}`)) {
      return this.customSchemas.get(`${platform}:${schemaType}`) || null;
    }
    if (this.customSchemas.has(`items:${schemaType}`)) {
      return this.customSchemas.get(`items:${schemaType}`) || null;
    }
    if (this.customSchemas.has(schemaType)) {
      return this.customSchemas.get(schemaType) || null;
    }

    if (this.registry && typeof this.registry.getSchema === 'function') {
      if (platform) {
        const platformSchema = this.registry.getSchema(platform, schemaType);
        if (platformSchema) return platformSchema;
      }
      const itemSchema = this.registry.getSchema('items', schemaType);
      if (itemSchema) return itemSchema;
    }

    return null;
  }

  /**
   * Infer item schema type using discriminator properties:
   * - postId present -> 'comment-item'
   * - authorId present OR category present -> 'post-item'
   * - otherwise -> 'profile-item'
   *
   * @param {unknown} item
   * @returns {string}
   */
  inferItemType(item) {
    if (!item || typeof item !== 'object') {
      return 'profile-item';
    }
    const rec = /** @type {Record<string, unknown>} */ (item);
    // A present (non-undefined) postId is the comment discriminator.
    if (rec.postId !== undefined) {
      return 'comment-item';
    }
    // post-item: has a non-'profile' category or an authorId. Checking content/authorId
    // before category keeps a ProfileItem that happens to carry category:'profile'
    // from being mis-inferred as a post (and lets a media-only post with content===''
    // still resolve as post via authorId).
    if (rec.authorId !== undefined || (rec.category !== undefined && rec.category !== 'profile')) {
      return 'post-item';
    }
    return 'profile-item';
  }

  /**
   * Pure runtime validation of an item against its JSON schema.
   * Calculates score and classification without throwing.
   *
   * @param {string} platform
   * @param {unknown} item
   * @param {object} [opts]
   * @param {string} [opts.schemaType]
   * @returns {DriftValidationResult}
   */
  validate(platform, item, opts = {}) {
    // Non-object / null items are always corrupted — they cannot satisfy any item contract.
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        classification: 'corrupted',
        score: 0,
        missingFields: [],
        typeErrors: ['item must be a non-null object'],
      };
    }

    const schemaType = opts.schemaType || this.inferItemType(item);
    const schema = this.getSchema(platform, schemaType);

    if (!schema) {
      // Backward-compatible no-op when schema is not found
      return {
        classification: 'complete',
        score: 100,
        missingFields: [],
        typeErrors: [],
      };
    }

    const validationErrors = validateSchemaNode(schema, item, 'item');

    const requiredPattern = /\.([^.]+) is required$/;
    /** @type {string[]} */
    const missingRequiredFields = [];
    /** @type {string[]} */
    const typeErrors = [];

    for (const err of validationErrors) {
      const match = err.match(requiredPattern);
      if (match) {
        missingRequiredFields.push(match[1]);
      } else {
        typeErrors.push(err);
      }
    }

    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    /** @type {string[]} */
    const missingOptionalFields = [];

    if (schema.properties && item && typeof item === 'object') {
      const record = /** @type {Record<string, unknown>} */ (item);
      for (const key of Object.keys(schema.properties)) {
        if (!requiredSet.has(key)) {
          if (record[key] === undefined) {
            missingOptionalFields.push(key);
          }
        }
      }
    }

    const missingRequired = missingRequiredFields.length;
    const missingOptional = missingOptionalFields.length;
    const typeErrorsCount = typeErrors.length;

    // Deterministic capped score formula
    const score = Math.max(
      0,
      100 - (35 * missingRequired) - (15 * typeErrorsCount) - Math.min(20, 5 * missingOptional)
    );

    /** @type {DriftClassification} */
    let classification;
    if (missingRequired > 0 || typeErrorsCount > 0 || score < 70) {
      classification = 'corrupted';
    } else if (missingRequired === 0 && typeErrorsCount === 0 && missingOptional === 0) {
      classification = 'complete';
    } else {
      classification = 'degraded';
    }

    return {
      classification,
      score,
      missingFields: [...missingRequiredFields, ...missingOptionalFields],
      typeErrors,
    };
  }

  /**
   * Validates an item and throws PlatformError with ErrorTypes.DEGRADED_DATA
   * if the item is classified as 'corrupted'.
   *
   * @param {string} platform
   * @param {unknown} item
   * @param {object} [opts]
   * @param {string} [opts.schemaType]
   * @returns {DriftValidationResult}
   */
  validateOrThrow(platform, item, opts = {}) {
    const result = this.validate(platform, item, opts);

    if (result.classification === 'corrupted') {
      throw new PlatformError({
        type: ErrorTypes.DEGRADED_DATA,
        code: 'XACT_4220',
        message: `Item validation failed: corrupted contract on platform "${platform}" (score: ${result.score})`,
        suggestedAction: SuggestedActions.RETRY_WITH_DIFFERENT_ACCOUNT,
        platform,
        details: {
          score: result.score,
          missingFields: result.missingFields,
          typeErrors: result.typeErrors,
        },
      });
    }

    return result;
  }
}

export const globalSchemaDriftGuard = new SchemaDriftGuard();
