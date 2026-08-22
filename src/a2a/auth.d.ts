export const PERMISSIONS: string[];
export const PERMISSION_PRESETS: Record<string, string[]>;

export function generateApiKey(
  label: string,
  permissions?: string[],
  expiresInSec?: number
): Promise<{ key: string; label: string; permissions: string[]; expiresAt: string }>;

export function validateApiKey(key: string): Promise<{ valid: boolean; permissions?: string[]; label?: string }>;

export function revokeApiKey(key: string): Promise<boolean>;

export function listApiKeys(): Promise<Array<{ label: string; permissions: string[]; createdAt: string; expiresAt: string; revoked: boolean }>>;

export function generateToken(
  agentId: string,
  permissions?: string[],
  expiresInSec?: number
): Promise<string>;

export function validateToken(token: string): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }>;

export function refreshToken(token: string): Promise<string>;

export function checkPermission(auth: { permissions: string[] } | null | undefined, requiredPermission: string): boolean;

export function createAuthMiddleware(options?: Record<string, unknown>): (...args: unknown[]) => unknown;

export function createOutboundAuth(options?: Record<string, unknown>): Record<string, unknown>;

export function getOutboundAuth(name: string): Record<string, unknown> | undefined;

export function applyAuth(req: Record<string, unknown>, options?: Record<string, unknown>): Promise<boolean>;

declare const _default: Record<string, unknown>;
export default _default;
