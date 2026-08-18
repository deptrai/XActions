// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AbstractLogin — non-invasive authentication contract.
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @typedef {import('./types.js').LoginResult} LoginResult */

export class AbstractLogin {
  /** @type {string} */
  name = 'base';

  constructor() {
    if (new.target === AbstractLogin) {
      throw new TypeError('AbstractLogin is abstract; extend it.');
    }
  }

  /** @returns {Promise<LoginResult>} */
  async login() {
    throw new Error('Method not implemented: login()');
  }

  /** @returns {Promise<LoginResult>} */
  async refresh() {
    throw new Error('Method not implemented: refresh()');
  }

  /** @returns {Promise<boolean>} */
  async isAuthenticated() {
    throw new Error('Method not implemented: isAuthenticated()');
  }
}
