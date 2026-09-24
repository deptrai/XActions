// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Server-only backend URL configuration.
 * Single source of truth for upstream API address.
 */

export function getApiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL || 'http://localhost:3001').replace(/\/+$/, '');
}

export const API_INTERNAL_URL = getApiInternalUrl();
