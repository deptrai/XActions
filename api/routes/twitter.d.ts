import type { AxiosInstance } from 'axios';
import type { IRouter } from 'express';

export function getTwitterClient(user: Record<string, unknown>): Promise<AxiosInstance>;

declare const router: IRouter;
export default router;
