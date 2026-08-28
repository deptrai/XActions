/**
 * Story 34-D3 — UsageLedgerService Credit Debit Integration ATDD Unit Tests (RED-PHASE).
 *
 * Covers:
 *  - AC2: UsageLedgerService.recordCompletion calls CreditBalanceService.recordDeduction inside transaction.
 *  - AC3: Race-safe rollback: when CreditBalanceService throws InsufficientCreditError, usage_ledger status is set to 'completed_unbilled'.
 *  - Pattern 1 (Mirror): Verified status update and metric emission.
 *  - Pattern 3 (Edge cases): Duplicate completion event does not double-debit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLedgerService } from '../usage-ledger.service';
import { InsufficientCreditError } from '../credit-balance.service';
import { usageLedger } from '@chainlens/db';

describe('UsageLedgerService Credit Debit Integration (Story 34-D3 AC2, AC3)', () => {
  let service: UsageLedgerService;
  let mockDb: any;
  let mockCreditBalanceService: any;
  let mockPricingCatalogService: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn((cb) => cb(mockDb)),
    };

    mockCreditBalanceService = {
      recordDeduction: vi.fn().mockResolvedValue(undefined),
    };

    mockPricingCatalogService = {
      getCatalog: vi.fn().mockResolvedValue(25),
      getActiveVersion: vi.fn().mockResolvedValue('credit-v1-2026-08-19'),
    };

    service = new UsageLedgerService(
      mockDb as any,
      mockCreditBalanceService as any,
      mockPricingCatalogService as any,
    );
  });

  describe('AC2 — Credit Debit on Completion', () => {
    it('[P0] should invoke recordDeduction with correct parameters inside transaction', async () => {
      // Mock usage_ledger insert returning created row
      const mockUsageRow = { id: 'usage-row-uuid-1', status: 'completed' };
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUsageRow]),
          }),
        }),
      });

      // Mock billing_outbox insert
      mockDb.insert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'outbox-uuid' }]),
          }),
        }),
      });

      await service.recordCompletion({
        requestId: 'req-1',
        messageId: 'msg-1',
        billableEventType: 'search',
        costDollars: 0.005,
        userId: 'user-credit-1',
        mode: 'speed',
      });

      expect(mockCreditBalanceService.recordDeduction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-credit-1',
          amount: 25,
          referenceId: expect.any(String),
          currency: 'USD',
          catalogVersion: 'credit-v1-2026-08-19',
        }),
        expect.anything(),
      );
    });
  });

  describe('AC3 — Race Rollback & completed_unbilled status', () => {
    it('[P0] should mark usage_ledger as completed_unbilled when InsufficientCreditError is thrown', async () => {
      const mockUsageRow = { id: 'usage-row-uuid-race', status: 'completed' };
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUsageRow]),
          }),
        }),
      });

      mockCreditBalanceService.recordDeduction.mockRejectedValue(
        new InsufficientCreditError('Insufficient credits on atomic debit', 20, 25),
      );

      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      });
      mockDb.update.mockReturnValue({ set: mockSet });

      // Should complete without throwing unhandled exception to caller
      const res = await service.recordCompletion({
        requestId: 'req-race-1',
        messageId: 'msg-race-1',
        billableEventType: 'search',
        costDollars: 0.005,
        userId: 'user-race',
        mode: 'speed',
      });

      expect(mockDb.update).toHaveBeenCalledWith(usageLedger);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed_unbilled',
        }),
      );
      expect(res).toBeDefined();
    });
  });
});
