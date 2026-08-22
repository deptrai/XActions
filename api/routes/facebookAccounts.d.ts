import type { IRouter } from 'express';

export function encrypt(text: string): string;
export function decrypt(encryptedData: string): string | null;
export function validateAccountBody(body: Record<string, unknown>): string | null;
export function resolveAccountCookie(userId: string, accountId: string): Promise<{ c_user: string; xs: string; }>;

declare const router: IRouter;
export default router;
