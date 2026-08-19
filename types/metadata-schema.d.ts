// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TypeScript Type Declarations for Metadata Schema Registry
 * @author nich (@nichxbt)
 * @license MIT
 */

export interface JsonSchema {
  $schema?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SchemaDescriptor {
  platform: string;
  category: string;
  title: string;
  description: string;
  version: string;
  propertiesCount: number;
}

export interface MetadataSchemaRegistry {
  /**
   * Register a JSON schema for a specific platform and category
   */
  registerSchema(platform: string, category: string, schema: JsonSchema): void;

  /**
   * Get the JSON schema definition for a specific platform and category
   */
  getSchema(platform: string, category: string): JsonSchema | null;

  /**
   * Check if a schema is registered
   */
  hasSchema(platform: string, category: string): boolean;

  /**
   * Recursively discover and register all .json files in a directory
   */
  loadSchemasFromDisk(schemasDir: string): void;

  /**
   * Validate a metadata object against the registered schema for its platform and category
   */
  validateMetadata(platform: string, category: string, metadata: unknown): ValidationResult;

  /**
   * List all registered schemas
   */
  listSchemas(): SchemaDescriptor[];
}

export const metadataSchemaRegistry: MetadataSchemaRegistry;
