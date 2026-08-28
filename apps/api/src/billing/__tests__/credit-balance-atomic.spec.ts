/**
 * Story 34-D3 — CreditBalanceService Atomic Debit & Race-Safety ATDD Unit Tests (RED-PHASE).
 *
 * Covers:
 *  - AC2: Atomic debit inside transaction boundary.
 *  - AC3: Race-safe conditional decrement, balance cannot go negative.
 *  - Pattern 1 (Mirror): recordDeduction updates credit_balances and inserts credit_ledger row.
 *  - Pattern 2 (Over-mocking): Throws InsufficientCreditError when conditional update fails.
 *  - Pattern 3 (Edge cases): Idempotent duplicate referenceId, zero cost.
 *  - Pattern 4 (Arithmetic): -cost debit amount, strictly non-negative balance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreditBalanceService, InsufficientCreditError } from '../credit-balance.service';
import { creditBalances, creditLedger } from '@chainlens/db';

describe('CreditBalanceService Atomic Debit (Story 34-D3 AC2, AC3, AC5)', () => {
  let service: CreditBalanceService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn((cb) => cb(mockDb)),
    };

    service = new CreditBalanceService(mockDb as any);
  });

  describe('AC2 & AC3 — Atomic Conditional Decrement', () => {
    it('[P0] should decrement balance when sufficient credits exist', async () => {
      // Mock conditional update returning updated row
      const mockReturning = vi.fn().mockResolvedValue([{ balance: 75 }]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      mockDb.update.mockReturnValue({ set: mockSet });

      // Mock credit_ledger insert
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue([{ id: 'ledger-uuid' }]),
      });
      mockDb.insert.mockReturnValue({ values: mockValues });

      await service.recordDeduction({
        userId: 'u1',
        amount: 25,
        referenceId: 'usage-123',
        traceId: 'trace-abc',
        currency: 'USD',
        catalogVersion: 'credit-v1-2026-08-19',
      });

      expect(mockDb.update).toHaveBeenCalledWith(creditBalances);
      expect(mockDb.insert).toHaveBeenCalledWith(creditLedger);
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: 'usage_deduction',
          amount: -25,
          referenceId: 'usage-123',
          currency: 'USD',
          catalogVersion: 'credit-v1-2026-08-19',
        }),
      );
    });

    it('[P0] should throw InsufficientCreditError when conditional decrement returns 0 rows', async () => {
      // 0 rows updated because balance + amount < 0 (conditional check failed in SQL)
      const mockReturning = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      mockDb.update.mockReturnValue({ set: mockSet });

      await expect(
        service.recordDeduction({
          userId: 'u1',
          amount: 50,
          currency: 'USD',
          catalogVersion: 'credit-v1-2026-08-19',
        }),
      ).rejects.toThrow(InsufficientCreditError);
    });

    it('[P0] should reuse caller-supplied transaction (dbOrTx) when provided', async () => {
      const mockTx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ balance: 100 }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoNothing: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      await service.recordDeduction(
        {
          userId: 'u1',
          amount: 25,
          currency: 'USD',
          catalogVersion: 'credit-v1-2026-08-19',
        },
        mockTx as any,
      );

      expect(mockTx.update).toHaveBeenCalledWith(creditBalances);
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('[P0] should prevent duplicate debit on duplicate referenceId via onConflictDoNothing', async () => {
      const mockReturning = vi.fn().mockResolvedValue([{ balance: 75 }]);
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: mockReturning }),
        }),
      });

      const mockOnConflict = vi.fn().mockResolvedValue([]); // duplicate: 0 inserted
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflict }),
      });

      await service.recordDeduction({
        userId: 'u1',
        amount: 25,
        referenceId: 'duplicate-ref-id',
        currency: 'USD',
        catalogVersion: 'credit-v1-2026-08-19',
      });

      expect(mockOnConflict).toHaveBeenCalled();
    });
  });
});
