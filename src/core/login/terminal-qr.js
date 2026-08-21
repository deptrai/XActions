// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TerminalQrLogin — Terminal ASCII QR Code authentication handler.
 * @author nich (@nichxbt)
 * @license MIT
 */

import { AbstractLogin } from '../base-login.js';

export class TerminalQrLogin extends AbstractLogin {
  /** @type {string} */
  name = 'terminal-qr';

  constructor(options = {}) {
    super();
    this.options = options;
  }

  generateShortCode() {
    throw new Error('Method not implemented: generateShortCode()');
  }

  async login() {
    throw new Error('Method not implemented: login()');
  }
}
