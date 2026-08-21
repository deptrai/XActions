// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TwitterPlatformResponseValidator — recognizes GraphQL and HTML payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class TwitterPlatformResponseValidator extends AbstractPlatformResponseValidator {
  isValidPayload(response) {
    throw new Error('Not implemented');
  }

  isBotChallenge(response) {
    throw new Error('Not implemented');
  }

  isRateLimit(response) {
    throw new Error('Not implemented');
  }
}
