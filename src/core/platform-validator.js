// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractPlatformResponseValidator — contract for detecting bot/rate-limit payloads.
 * Subclasses implement platform-specific logic to decide whether a response is valid,
 * a bot challenge, or a rate-limit signal.
 * @author nich (@nichxbt)
 * @license MIT
 */

export class AbstractPlatformResponseValidator {
  /** @type {string} */
  platform = 'base';

  constructor() {
    if (new.target === AbstractPlatformResponseValidator) {
      throw new TypeError('AbstractPlatformResponseValidator is abstract; extend it.');
    }
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isValidPayload(response) {
    throw new Error('Method not implemented: isValidPayload()');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isBotChallenge(response) {
    throw new Error('Method not implemented: isBotChallenge()');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isRateLimit(response) {
    throw new Error('Method not implemented: isRateLimit()');
  }

  /**
   * @param {any} response
   * @returns {boolean}
   */
  isLoginWall(response) {
    return false;
  }
}
