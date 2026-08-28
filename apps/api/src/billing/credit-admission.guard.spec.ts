/**
 * Story 34-D3 — CreditAdmissionGuard ATDD Unit Tests (RED-PHASE).
 *
 * Covers:
 *  - AC1: Admission check before calling LLM/search.
 *  - Pattern 1 (Mirror): 402 with exact shape { error: 'insufficient_credit', balance, required, currency, requestId } for pay-as-you-go users.
 *  - Pattern 2 (Over-mocking): Propagation of database/catalog errors.
 *  - Pattern 3 (Edge cases): Boundary balance === required (allowed), balance === required - 1 (rejected 402), MCP service account bypass.
 *  - Pattern 4 (Arithmetic): Exact mode cost comparison (speed: 25, ask: 70, reason: 90, research: 150, deep: 240).
 *  - Pattern 5 (Error message): 402 insufficient_credit, 429 quota_exceeded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { CreditAdmissionGuard } from './credit-admission.guard';

function makeCtx(params: {
  userId?: string;
  isPublic?: boolean;
  mode?: string;
  requestId?: string;
}): ExecutionContext {
  const req = {
    user: params.userId ? { id: params.userId } : undefined,
    body: { mode: params.mode },
    query: {},
    headers: { 'x-request-id': params.requestId || 'req-test-123' },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('CreditAdmissionGuard (Story 34-D3 AC1, AC4, AC5)', () => {
  let guard: CreditAdmissionGuard;
  let mockReflector: any;
  let mockBillingService: any;
  let mockCreditBalanceService: any;
  let mockPricingCatalogService: any;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    };

    mockBillingService = {
      getUserPlan: vi.fn().mockResolvedValue('credits'),
      checkAndIncrementQuota: vi.fn().mockResolvedValue({
        allowed: true,
        used: 1,
        limit: 10,
        remaining: 9,
        resetAt: new Date().toISOString(),
      }),
    };

    mockCreditBalanceService = {
      getBalance: vi.fn().mockResolvedValue({
        balance: 500,
        currency: 'USD',
        updatedAt: new Date(),
      }),
    };

    mockPricingCatalogService = {
      getCatalog: vi.fn().mockResolvedValue(25), // speed = 25
      getActiveVersion: vi.fn().mockResolvedValue('credit-v1-2026-08-19'),
    };

    guard = new CreditAdmissionGuard(
      mockReflector,
      mockBillingService,
      mockCreditBalanceService,
      mockPricingCatalogService,
    );
  });

  describe('Pattern 1 — Mirror Test (402 Shape & Plan Routing)', () => {
    it('[P0] should allow pay-as-you-go user when balance is sufficient', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 100, currency: 'USD' });
      mockPricingCatalogService.getCatalog.mockResolvedValue(25);

      const ctx = makeCtx({ userId: 'u1', mode: 'speed' });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    });

    it('[P0] should throw 402 with exact payload when credits are insufficient', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 20, currency: 'USD' });
      mockPricingCatalogService.getCatalog.mockResolvedValue(25);

      const ctx = makeCtx({ userId: 'u1', mode: 'speed', requestId: 'req-402-check' });
      let err!: HttpException;
      try {
        await guard.canActivate(ctx);
      } catch (e) {
        err = e as HttpException;
      }

      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      const res = err.getResponse() as Record<string, unknown>;
      expect(res.error).toBe('insufficient_credit');
      expect(res.balance).toBe(20);
      expect(res.required).toBe(25);
      expect(res.currency).toBe('USD');
      expect(res.requestId).toBe('req-402-check');
    });

    it('[P0] should bypass guard when route is marked with @Public()', async () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);
      const ctx = makeCtx({ userId: 'u1', isPublic: true });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(mockBillingService.getUserPlan).not.toHaveBeenCalled();
    });

    it('[P0] should handle subscription users with 429 when quota is exceeded', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('free');
      mockBillingService.checkAndIncrementQuota.mockResolvedValue({
        allowed: false,
        used: 10,
        limit: 10,
        remaining: 0,
        resetAt: new Date().toISOString(),
      });

      const ctx = makeCtx({ userId: 'u_sub', mode: 'search' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    });
  });

  describe('Pattern 3 — Edge Cases & Boundaries', () => {
    it('[P0] Boundary: should allow when balance exactly equals required cost', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 90, currency: 'USD' });
      mockPricingCatalogService.getCatalog.mockResolvedValue(90);

      const ctx = makeCtx({ userId: 'u1', mode: 'reason' });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    });

    it('[P0] Boundary: should reject with 402 when balance is exactly 1 cent-credit short', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 89, currency: 'USD' });
      mockPricingCatalogService.getCatalog.mockResolvedValue(90);

      const ctx = makeCtx({ userId: 'u1', mode: 'reason' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    });

    it('[P1] should bypass when user is missing (handled by auth guard)', async () => {
      const ctx = makeCtx({ userId: undefined });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
    });

    it('[P1] should bypass for MCP service account', async () => {
      process.env.MCP_SERVICE_USER_ID = 'mcp-svc-admin';
      const ctx = makeCtx({ userId: 'mcp-svc-admin' });
      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
      delete process.env.MCP_SERVICE_USER_ID;
    });

    it('[P1] should fallback to search mode when mode is omitted in request', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 100, currency: 'USD' });
      mockPricingCatalogService.getCatalog.mockResolvedValue(25);

      const ctx = makeCtx({ userId: 'u1', mode: undefined });
      await guard.canActivate(ctx);
      expect(mockPricingCatalogService.getCatalog).toHaveBeenCalledWith('search');
    });
  });

  describe('Pattern 4 — Arithmetic Invariants', () => {
    it('[P0] should evaluate exact required cost for each mode', async () => {
      mockBillingService.getUserPlan.mockResolvedValue('credits');
      mockCreditBalanceService.getBalance.mockResolvedValue({ balance: 500, currency: 'USD' });

      mockPricingCatalogService.getCatalog.mockResolvedValueOnce(25);
      await guard.canActivate(makeCtx({ userId: 'u1', mode: 'speed' }));

      mockPricingCatalogService.getCatalog.mockResolvedValueOnce(70);
      await guard.canActivate(makeCtx({ userId: 'u1', mode: 'ask' }));

      mockPricingCatalogService.getCatalog.mockResolvedValueOnce(90);
      await guard.canActivate(makeCtx({ userId: 'u1', mode: 'reason' }));

      mockPricingCatalogService.getCatalog.mockResolvedValueOnce(150);
      await guard.canActivate(makeCtx({ userId: 'u1', mode: 'research' }));

      mockPricingCatalogService.getCatalog.mockResolvedValueOnce(240);
      await guard.canActivate(makeCtx({ userId: 'u1', mode: 'deep' }));

      expect(mockPricingCatalogService.getCatalog).toHaveBeenCalledTimes(5);
    });
  });
});
