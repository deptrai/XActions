import { Persona, ActivityPlan } from './types/xactions.js';

export type Plan = ActivityPlan;

export function createPersona(options?: Record<string, unknown>): Persona;
export function savePersona(persona: Persona): void;
export function loadPersona(id: string): Persona | null;
export function listPersonas(): Persona[];
export function deletePersona(id: string): boolean;
export function buildPersonaSystemPrompt(persona: Persona): string;
export function buildCommentPrompt(persona: Persona, tweetText: string, tweetAuthor: string): string;
export function buildPostPrompt(persona: Persona, context?: Record<string, unknown>): string;
export function buildReplyPrompt(persona: Persona, originalTweet: Record<string, unknown>, replyTo: string): string;
export function shouldBeActive(persona: Persona): boolean;
export function getActivityIntensity(persona: Persona): number;
export function getSessionDuration(persona: Persona): number;
export function getDelayUntilNextSession(persona: Persona): number;
export function planSession(persona: Persona): Plan;

export const NICHE_PRESETS: Record<string, Record<string, unknown>>;
export const ACTIVITY_PATTERNS: Record<string, Record<string, unknown>>;
export const ENGAGEMENT_STRATEGIES: Record<string, Record<string, unknown>>;

declare const _default: Record<string, unknown>;
export default _default;
