// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookPlatformResponseValidator — recognizes HTML and normalized payload shapes.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class FacebookPlatformResponseValidator extends AbstractPlatformResponseValidator {
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
