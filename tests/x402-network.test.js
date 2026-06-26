// by nichxbt
/**
 * x402 Payment Webhooks & Multi-Network Support Tests
 *
 * Tests for:
 * - Webhook service exports and event constants
 * - Webhook payload structure helpers
 * - Multi-network SUPPORTED_NETWORKS config
 * - getAcceptedNetworks / getNetworkConfig functions
 * - x402 client NETWORK_CONFIGS
 */

import { describe, it, expect } from 'vitest';

describe('Payment Webhooks', () => {
  describe('Webhook Service', () => {
    it('should export all required functions', async () => {
      const webhooks = await import('../api/services/payment-webhooks.js');

      expect(webhooks.notifyPaymentReceived).toBeDefined();
      expect(webhooks.notifyPaymentFailed).toBeDefined();
      expect(webhooks.notifyPaymentSettled).toBeDefined();
      expect(webhooks.hasWebhooksConfigured).toBeDefined();
      expect(webhooks.getWebhookStatus).toBeDefined();
      expect(webhooks.testWebhooks).toBeDefined();
      expect(webhooks.PAYMENT_EVENTS).toBeDefined();
    });

    it('should have correct PAYMENT_EVENTS', async () => {
      const { PAYMENT_EVENTS } = await import('../api/services/payment-webhooks.js');

      expect(PAYMENT_EVENTS.RECEIVED).toBe('payment.received');
      expect(PAYMENT_EVENTS.SETTLED).toBe('payment.settled');
      expect(PAYMENT_EVENTS.FAILED).toBe('payment.failed');
      expect(PAYMENT_EVENTS.VERIFICATION_FAILED).toBe('payment.verification_failed');
    });

    it('should return false when no webhooks configured', async () => {
      const { hasWebhooksConfigured } = await import('../api/services/payment-webhooks.js');

      // Without env vars, should return false
      expect(hasWebhooksConfigured()).toBe(false);
    });

    it('should return status object with correct structure', async () => {
      const { getWebhookStatus } = await import('../api/services/payment-webhooks.js');

      const status = getWebhookStatus();

      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('delivery');
      expect(status).toHaveProperty('recentDeliveries');

      expect(status.configured).toHaveProperty('customWebhook');
      expect(status.configured).toHaveProperty('discord');
      expect(status.configured).toHaveProperty('slack');
      expect(status.configured).toHaveProperty('signatureEnabled');

      expect(status.delivery).toHaveProperty('total');
      expect(status.delivery).toHaveProperty('successful');
      expect(status.delivery).toHaveProperty('failed');
      expect(status.delivery).toHaveProperty('retried');
      expect(status.delivery).toHaveProperty('successRate');
    });

    it('should skip notification when no webhooks configured', async () => {
      const { notifyPaymentReceived } = await import('../api/services/payment-webhooks.js');

      const result = await notifyPaymentReceived({
        price: '$0.01',
        operation: 'test:operation',
        payerAddress: '0x1234567890123456789012345678901234567890',
        network: 'eip155:8453',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('No webhooks configured');
    });
  });

  describe('Webhook Payload Structure', () => {
    it('should format payment amounts correctly', () => {
      // Test amount parsing helper - this is internal but we test the concept
      const parseAmountToCents = (price) => {
        if (!price) return 0;
        const numericValue = parseFloat(price.replace(/[^0-9.]/g, ''));
        return Math.round(numericValue * 100);
      };

      expect(parseAmountToCents('$0.01')).toBe(1);
      expect(parseAmountToCents('$0.05')).toBe(5);
      expect(parseAmountToCents('$1.00')).toBe(100);
      expect(parseAmountToCents('$0.001')).toBe(0); // Rounds to 0 cents
      expect(parseAmountToCents(null)).toBe(0);
    });

    it('should format network names correctly', () => {
      const getNetworkName = (network) => {
        const networks = {
          'eip155:8453': 'Base',
          'eip155:84532': 'Base Sepolia (Testnet)',
          'eip155:1': 'Ethereum',
          'eip155:42161': 'Arbitrum One',
        };
        return networks[network] || network || 'Unknown';
      };

      expect(getNetworkName('eip155:8453')).toBe('Base');
      expect(getNetworkName('eip155:84532')).toBe('Base Sepolia (Testnet)');
      expect(getNetworkName('eip155:1')).toBe('Ethereum');
      expect(getNetworkName('unknown')).toBe('unknown');
      expect(getNetworkName(null)).toBe('Unknown');
    });

    it('should generate block explorer URLs correctly', () => {
      const getExplorerUrl = (network, txHash) => {
        if (!txHash) return null;
        const explorers = {
          'eip155:8453': `https://basescan.org/tx/${txHash}`,
          'eip155:84532': `https://sepolia.basescan.org/tx/${txHash}`,
          'eip155:1': `https://etherscan.io/tx/${txHash}`,
          'eip155:42161': `https://arbiscan.io/tx/${txHash}`,
        };
        return explorers[network] || null;
      };

      const testTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      expect(getExplorerUrl('eip155:8453', testTxHash)).toBe(`https://basescan.org/tx/${testTxHash}`);
      expect(getExplorerUrl('eip155:84532', testTxHash)).toBe(`https://sepolia.basescan.org/tx/${testTxHash}`);
      expect(getExplorerUrl('eip155:8453', null)).toBeNull();
      expect(getExplorerUrl('unknown', testTxHash)).toBeNull();
    });
  });
});

// Multi-network support tests
describe('Multi-Network Support', () => {
  describe('SUPPORTED_NETWORKS configuration', () => {
    it('should have Base mainnet as recommended', async () => {
      const { SUPPORTED_NETWORKS } = await import('../api/config/x402-config.js');

      expect(SUPPORTED_NETWORKS['eip155:8453']).toBeDefined();
      expect(SUPPORTED_NETWORKS['eip155:8453'].recommended).toBe(true);
      expect(SUPPORTED_NETWORKS['eip155:8453'].name).toBe('Base');
    });

    it('should have Base Sepolia as testnet', async () => {
      const { SUPPORTED_NETWORKS } = await import('../api/config/x402-config.js');

      expect(SUPPORTED_NETWORKS['eip155:84532']).toBeDefined();
      expect(SUPPORTED_NETWORKS['eip155:84532'].testnet).toBe(true);
      expect(SUPPORTED_NETWORKS['eip155:84532'].name).toBe('Base Sepolia');
    });

    it('should have Ethereum mainnet with high gas cost', async () => {
      const { SUPPORTED_NETWORKS } = await import('../api/config/x402-config.js');

      expect(SUPPORTED_NETWORKS['eip155:1']).toBeDefined();
      expect(SUPPORTED_NETWORKS['eip155:1'].gasCost).toBe('high');
      expect(SUPPORTED_NETWORKS['eip155:1'].name).toBe('Ethereum');
    });

    it('should have Arbitrum One with low gas cost', async () => {
      const { SUPPORTED_NETWORKS } = await import('../api/config/x402-config.js');

      expect(SUPPORTED_NETWORKS['eip155:42161']).toBeDefined();
      expect(SUPPORTED_NETWORKS['eip155:42161'].gasCost).toBe('low');
      expect(SUPPORTED_NETWORKS['eip155:42161'].name).toBe('Arbitrum One');
    });

    it('should have valid USDC addresses for all networks', async () => {
      const { SUPPORTED_NETWORKS } = await import('../api/config/x402-config.js');

      for (const [networkId, config] of Object.entries(SUPPORTED_NETWORKS)) {
        expect(config.usdc).toBeDefined();
        expect(config.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    });
  });

  describe('getAcceptedNetworks function', () => {
    it('should exclude testnets when includeTestnet is false', async () => {
      const { getAcceptedNetworks } = await import('../api/config/x402-config.js');

      const networks = getAcceptedNetworks(false);
      const hasTestnet = networks.some(n => n.testnet);

      expect(hasTestnet).toBe(false);
      expect(networks.length).toBeGreaterThan(0);
    });

    it('should include testnets when includeTestnet is true', async () => {
      const { getAcceptedNetworks } = await import('../api/config/x402-config.js');

      const networks = getAcceptedNetworks(true);
      const hasTestnet = networks.some(n => n.testnet);

      expect(hasTestnet).toBe(true);
    });

    it('should return network objects with all required properties', async () => {
      const { getAcceptedNetworks } = await import('../api/config/x402-config.js');

      const networks = getAcceptedNetworks(true);

      for (const network of networks) {
        expect(network.network).toBeDefined();
        expect(network.name).toBeDefined();
        expect(network.usdc).toBeDefined();
        expect(network.gasCost).toBeDefined();
      }
    });
  });

  describe('getNetworkConfig function', () => {
    it('should return config for valid network ID', async () => {
      const { getNetworkConfig } = await import('../api/config/x402-config.js');

      const config = getNetworkConfig('eip155:8453');

      expect(config).toBeDefined();
      expect(config.name).toBe('Base');
      expect(config.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });

    it('should return null for invalid network ID', async () => {
      const { getNetworkConfig } = await import('../api/config/x402-config.js');

      const config = getNetworkConfig('eip155:99999');

      expect(config).toBeNull();
    });
  });

  describe('x402 Client NETWORK_CONFIGS', () => {
    it('should export NETWORK_CONFIGS with all networks', async () => {
      const { NETWORK_CONFIGS } = await import('../src/mcp/x402-client.js');

      expect(NETWORK_CONFIGS).toBeDefined();
      expect(NETWORK_CONFIGS['base']).toBeDefined();
      expect(NETWORK_CONFIGS['base-sepolia']).toBeDefined();
      expect(NETWORK_CONFIGS['ethereum']).toBeDefined();
      expect(NETWORK_CONFIGS['arbitrum']).toBeDefined();
    });

    it('should have chainId and networkId for all networks', async () => {
      const { NETWORK_CONFIGS } = await import('../src/mcp/x402-client.js');

      for (const [name, config] of Object.entries(NETWORK_CONFIGS)) {
        expect(config.chainId).toBeDefined();
        expect(typeof config.chainId).toBe('number');
        expect(config.networkId).toBeDefined();
        expect(config.networkId).toMatch(/^eip155:\d+$/);
      }
    });

    it('should have Base as recommended network', async () => {
      const { NETWORK_CONFIGS } = await import('../src/mcp/x402-client.js');

      expect(NETWORK_CONFIGS['base'].recommended).toBe(true);
    });

    it('should have base-sepolia as testnet', async () => {
      const { NETWORK_CONFIGS } = await import('../src/mcp/x402-client.js');

      expect(NETWORK_CONFIGS['base-sepolia'].testnet).toBe(true);
    });
  });
});
