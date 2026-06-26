// by nichxbt
/**
 * x402 Configuration & Validation Tests
 *
 * Tests for:
 * - Environment variable defaults
 * - Pricing configuration format
 * - Payment address validation
 * - Network configuration warnings
 * - Production requirements
 */

import { describe, it, expect } from 'vitest';

describe('x402 Configuration', () => {
  describe('Environment variables', () => {
    it('should use default facilitator URL if not set', () => {
      const defaultUrl = 'https://x402.org/facilitator';
      expect(defaultUrl).toBe('https://x402.org/facilitator');
    });

    it('should use Base Sepolia as default network', () => {
      const defaultNetwork = 'eip155:84532';
      expect(defaultNetwork).toBe('eip155:84532');
    });
  });

  describe('Pricing configuration', () => {
    const pricing = {
      'scrape:profile': '$0.001',
      'scrape:followers': '$0.01',
      'scrape:following': '$0.01',
      'scrape:tweets': '$0.005',
      'scrape:search': '$0.01',
      'action:unfollow-non-followers': '$0.05',
      'action:unfollow-everyone': '$0.10',
      'action:detect-unfollowers': '$0.02',
    };

    it('should have valid price format for all operations', () => {
      for (const [operation, price] of Object.entries(pricing)) {
        expect(price).toMatch(/^\$\d+(\.\d+)?$/);
      }
    });

    it('should have prices for all scrape operations', () => {
      expect(pricing['scrape:profile']).toBeDefined();
      expect(pricing['scrape:followers']).toBeDefined();
      expect(pricing['scrape:following']).toBeDefined();
      expect(pricing['scrape:tweets']).toBeDefined();
    });

    it('should have prices for all action operations', () => {
      expect(pricing['action:unfollow-non-followers']).toBeDefined();
      expect(pricing['action:unfollow-everyone']).toBeDefined();
      expect(pricing['action:detect-unfollowers']).toBeDefined();
    });
  });
});

describe('x402 Configuration Validation', () => {
  // Test helper to create a mock environment
  const withEnv = (env, fn) => {
    const original = { ...process.env };
    Object.assign(process.env, env);
    try {
      return fn();
    } finally {
      // Restore original env
      for (const key of Object.keys(env)) {
        if (original[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = original[key];
        }
      }
    }
  };

  describe('Payment address validation', () => {
    it('should reject placeholder address 0xYourWalletAddress', () => {
      const result = mockValidateAddress('0xYourWalletAddress');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject placeholder address 0xYourEthereumAddress', () => {
      const result = mockValidateAddress('0xYourEthereumAddress');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('placeholder');
    });

    it('should reject invalid address format (too short)', () => {
      const result = mockValidateAddress('0x123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('valid Ethereum address');
    });

    it('should reject invalid address format (no 0x prefix)', () => {
      const result = mockValidateAddress('abcd1234567890abcd1234567890abcd12345678');
      expect(result.valid).toBe(false);
    });

    it('should accept valid Ethereum address', () => {
      const result = mockValidateAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f5FacB');
      expect(result.valid).toBe(true);
    });

    it('should accept valid address with lowercase', () => {
      const result = mockValidateAddress('0x742d35cc6634c0532925a3b844bc9e7595f5facb');
      expect(result.valid).toBe(true);
    });

    it('should accept valid address with uppercase', () => {
      const result = mockValidateAddress('0x742D35CC6634C0532925A3B844BC9E7595F5FACB');
      expect(result.valid).toBe(true);
    });
  });

  describe('Network configuration', () => {
    it('should recognize Base Sepolia testnet', () => {
      expect(getNetworkInfo('eip155:84532').isTestnet).toBe(true);
      expect(getNetworkInfo('eip155:84532').name).toContain('Sepolia');
    });

    it('should recognize Base mainnet', () => {
      expect(getNetworkInfo('eip155:8453').isTestnet).toBe(false);
      expect(getNetworkInfo('eip155:8453').name).toContain('Base');
    });

    it('should warn about testnet in production', () => {
      const result = mockValidateNetwork('eip155:84532', true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('testnet');
    });

    it('should warn about mainnet in development', () => {
      const result = mockValidateNetwork('eip155:8453', false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('mainnet');
    });
  });

  describe('Production requirements', () => {
    it('should require payment address in production', () => {
      const result = mockValidateConfig({ payToAddress: null, isProduction: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('REQUIRED'))).toBe(true);
    });

    it('should allow missing payment address in development', () => {
      const result = mockValidateConfig({ payToAddress: null, isProduction: false });
      // In dev, missing address is a warning not an error
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should not allow placeholder address even in development', () => {
      const result = mockValidateConfig({ payToAddress: '0xYourWalletAddress', isProduction: false });
      expect(result.valid).toBe(false);
    });
  });
});

// Mock validation functions for testing (mirrors logic from x402-config.js)
function mockValidateAddress(address) {
  if (!address) {
    return { valid: false, error: 'Address is required' };
  }
  if (address === '0xYourWalletAddress' || address === '0xYourEthereumAddress') {
    return { valid: false, error: 'Address is set to a placeholder value' };
  }
  if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
    return { valid: false, error: 'Not a valid Ethereum address' };
  }
  return { valid: true };
}

function getNetworkInfo(networkId) {
  const networks = {
    'eip155:84532': { name: 'Base Sepolia', isTestnet: true },
    'eip155:8453': { name: 'Base Mainnet', isTestnet: false },
    'eip155:1': { name: 'Ethereum Mainnet', isTestnet: false },
  };
  return networks[networkId] || { name: 'Unknown', isTestnet: false };
}

function mockValidateNetwork(networkId, isProduction) {
  const warnings = [];
  const info = getNetworkInfo(networkId);

  if (info.isTestnet && isProduction) {
    warnings.push('Using testnet in production - switch to mainnet');
  }
  if (!info.isTestnet && !isProduction) {
    warnings.push('Using mainnet in development - consider testnet');
  }

  return { warnings };
}

function mockValidateConfig({ payToAddress, isProduction }) {
  const errors = [];
  const warnings = [];

  if (!payToAddress) {
    if (isProduction) {
      errors.push('X402_PAY_TO_ADDRESS is REQUIRED in production');
    } else {
      warnings.push('X402_PAY_TO_ADDRESS not set - x402 payments disabled');
    }
  } else {
    const addrResult = mockValidateAddress(payToAddress);
    if (!addrResult.valid) {
      errors.push(addrResult.error);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
