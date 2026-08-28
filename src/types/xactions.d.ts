/// <reference lib="dom" />

import type { Page, Browser, LaunchOptions, ElementHandle } from 'puppeteer';

/**
 * Puppeteer Page with the browser reference attached by the multi-platform
 * scraper dispatcher so it can auto-close the browser it created.
 */
export interface PageWithBrowser extends Page {
  __xactions_browser?: Browser;
}

/**
 * Broad options bag used by most XActions manager functions. Explicitly lists
 * the optional keys that appear in the JSDoc, while an index signature lets
 * unknown/custom options through without widening to `any`.
 */
export interface XActionsOptions {
  [key: string]: unknown;
  limit?: number;
  format?: string;
  type?: string;
  tab?: string;
  scrolls?: number;
  direction?: 'up' | 'down';
  topic?: string;
  style?: string;
  since?: string;
  until?: string;
  query?: string;
  period?: string;
  duration?: string | number;
  keywords?: string[];
  delay?: number;
  url?: string;
  headless?: boolean | 'new';
  dryRun?: boolean;
  maxSessions?: number;
  onSessionComplete?: (result: Record<string, unknown>) => void;
  signal?: AbortSignal;
  sampleSize?: number;
  media?: string | string[];
  altText?: string;
  replyTo?: string;
  newChat?: boolean;
  waitTime?: number;
  durationDays?: number;
  durationHours?: number;
  durationMinutes?: number;
  location?: string;
  allowDMsFrom?: string;
  username?: string;
  hashtag?: string;
  instance?: string;
  service?: string;
  identifier?: string;
  password?: string;
  accessToken?: string;
  feedUri?: string;
  listUrl?: string;
  communityUrl?: string;
  browserOptions?: LaunchOptions & Record<string, unknown>;
  authToken?: string;
  authCookie?: Record<string, string>;
  client?: Record<string, unknown>;
  autoClose?: boolean;
  page?: PageWithBrowser;
  allWords?: string;
  exactPhrase?: string;
  anyWords?: string;
  noneOfWords?: string;
  hashtags?: string;
  from?: string;
  to?: string;
  mentioning?: string;
  minLikes?: number;
  minRetweets?: number;
  hasMedia?: boolean;
  hasLinks?: boolean;
  lang?: string;
}

/** Long-form article input for the article publisher. */
export interface ArticleInput {
  [key: string]: unknown;
  title: string;
  body: string;
  coverImage?: string;
}

/** Profile update payload. */
export interface ProfileUpdates {
  [key: string]: unknown;
  name?: string;
  bio?: string;
  location?: string;
  website?: string;
}

/** Event creation payload for Spaces/Events. */
export interface EventInput {
  [key: string]: unknown;
  title: string;
  description: string;
  date: string;
  time: string;
  location?: string;
}

/** An item in a thread passed to postThread. */
export type ThreadItem = string | { text: string; media?: string };

/** Advanced search filter bag. */
export interface SearchFilters {
  [key: string]: unknown;
  allWords?: string;
  exactPhrase?: string;
  anyWords?: string;
  noneOfWords?: string;
  hashtags?: string;
  from?: string;
  to?: string;
  mentioning?: string;
  since?: string;
  until?: string;
  minLikes?: number;
  minRetweets?: number;
  hasMedia?: boolean;
  hasLinks?: boolean;
  lang?: string;
  limit?: number;
}

/** Content preference toggles. */
export interface ContentPreferences {
  [key: string]: boolean;
}

/** DM privacy settings payload. */
export interface DMSettings {
  [key: string]: unknown;
  allowDMsFrom?: string;
}

/** Persona niche configuration. */
export interface PersonaNiche {
  [key: string]: unknown;
  name?: string;
  description?: string;
  topics: string[];
  searchTerms: string[];
  targetAccounts: string[];
  avoidTopics?: string[];
  avoidAccounts?: string[];
  tone?: string;
  commentStyle?: string;
  bioTemplate?: string;
  postTopics?: string[];
}

/** Persona voice / writing style. */
export interface PersonaVoice {
  [key: string]: unknown;
  tone: string;
  commentStyle: string;
  bioTemplate: string;
  postTopics: string[];
  emojiUsage: string;
  hashtagUsage: string;
  language: string;
  maxCommentLength: number;
  maxPostLength: number;
}

/** Persona activity / sleep schedule. */
export interface PersonaActivityPattern {
  [key: string]: unknown;
  preset?: string;
  name?: string;
  description?: string;
  activeHours: number[];
  peakHours: number[];
  sleepHours: number[];
  weekendMultiplier?: number;
  timezone?: string;
}

/** Persona engagement strategy. */
export interface PersonaStrategy {
  [key: string]: unknown;
  preset: string;
  dailyLimits: {
    follows: number;
    likes: number;
    comments: number;
    posts: number;
    searches: number;
    profileVisits: number;
  };
  followBackRatio: number;
  likeRatio: number;
  commentRatio: number;
  unfollowAfterDays: number;
  sessionLength: { min: number; max: number };
  sessionsPerDay: { min: number; max: number };
}

/** Persona LLM configuration. */
export interface PersonaLlm {
  [key: string]: unknown;
  provider: string;
  models: {
    comment: string;
    post: string;
    reply: string;
  };
  apiKey: string | null;
  temperature: number;
  systemPrompt: string | null;
}

/** Persona growth goals. */
export interface PersonaGoals {
  [key: string]: unknown;
  targetFollowers: number;
  targetPostsPerDay: number;
  targetEngagementRate: number;
  milestonesReached: unknown[];
}

/** Runtime state mutated by the algorithm builder. */
export interface PersonaState {
  [key: string]: unknown;
  totalSessions: number;
  totalFollows: number;
  totalLikes: number;
  totalComments: number;
  totalPosts: number;
  totalSearches: number;
  totalProfileVisits: number;
  totalUnfollows: number;
  followedUsers: Record<string, Record<string, unknown>>;
  engagedPosts: Set<string>;
  lastSessionAt: string | null;
  lastPostAt: string | null;
  currentFollowers: number;
  followerHistory: unknown[];
  errors: unknown[];
}

/** Full persona object used by the algorithm builder and engine. */
export interface Persona {
  [key: string]: unknown;
  id: string;
  name: string;
  preset: string;
  createdAt: string;
  updatedAt: string;
  niche: PersonaNiche;
  voice: PersonaVoice;
  activityPattern: PersonaActivityPattern;
  strategy: PersonaStrategy;
  llm: PersonaLlm;
  goals: PersonaGoals;
  state: PersonaState;
}

/** Options for createPersona. */
export interface PersonaOptions {
  [key: string]: unknown;
  id?: string;
  name?: string;
  preset?: string;
  activityPattern?: string;
  strategy?: string;
  topics?: string[];
  searchTerms?: string[];
  targetAccounts?: string[];
  avoidTopics?: string[];
  avoidAccounts?: string[];
  tone?: string;
  commentStyle?: string;
  bioTemplate?: string;
  postTopics?: string[];
  emojiUsage?: string;
  hashtagUsage?: string;
  language?: string;
  maxCommentLength?: number;
  maxPostLength?: number;
  timezone?: string;
  commentModel?: string;
  postModel?: string;
  replyModel?: string;
  apiKey?: string;
  temperature?: number;
  systemPrompt?: string;
  targetFollowers?: number;
  targetPostsPerDay?: number;
  targetEngagementRate?: number;
}

/** Tweet extracted by the algorithm builder. */
export interface VisibleTweet {
  text: string;
  author: string;
  isLiked: boolean;
  likes: number;
  index: number;
}

/** User cell extracted by the algorithm builder. */
export interface VisibleUser {
  username: string;
  bio: string;
  hasFollowButton: boolean;
}

/** A single planned activity for an algorithm-builder session. */
export interface Activity {
  [key: string]: unknown;
  type: string;
  term?: string;
  tab?: string;
  count?: number;
}

/** Session plan returned by planSession. */
export interface ActivityPlan {
  [key: string]: unknown;
  duration: number;
  activities: Activity[];
}

/** Options passed to startAlgorithmBuilder. */
export interface StartOptions extends XActionsOptions {
  personaId: string;
  authToken?: string;
}

/** OpenRouter chat-completion response shape. */
export interface LLMResponse {
  [key: string]: unknown;
  choices?: {
    [key: string]: unknown;
    message?: {
      [key: string]: unknown;
      content?: string;
    };
  }[];
}

/** Session statistics collected by runSession. */
export interface SessionStats {
  [key: string]: number;
  searches: number;
  likes: number;
  follows: number;
  unfollows: number;
  comments: number;
  posts: number;
  profileVisits: number;
  errors: number;
}

/** Plugin manifest interface. */
export interface PluginManifest {
  [key: string]: unknown;
  name: string;
  version: string;
  description?: string;
  actions?: Record<string, unknown>[];
  scrapers?: Record<string, unknown>[];
  tools?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  hooks?: Record<string, unknown>;
}

/** Plugin registry entry stored in ~/.xactions/plugins.json. */
export interface PluginEntry {
  [key: string]: unknown;
  package?: string;
  path?: string;
  version: string;
  description?: string;
  enabled: boolean;
  installedAt?: string;
}

/** Plugin configuration file shape. */
export interface PluginsConfig {
  [key: string]: unknown;
  plugins: Record<string, PluginEntry>;
}

/** Premium tier definition. */
export interface TierInfo {
  [key: string]: unknown;
  tier: string;
  price?: string;
  features?: Record<string, unknown>;
}

// ============================================================================
// Workflow Engine Types
// ============================================================================

/** A single step inside a workflow. */
export interface WorkflowStep {
  [key: string]: unknown;
  action?: string;
  condition?: string | WorkflowCondition;
  output?: string;
  onFail?: string;
  onError?: string;
}

/** A trigger configuration for a workflow. */
export interface WorkflowTrigger {
  [key: string]: unknown;
  type: 'manual' | 'schedule' | 'cron' | 'interval' | 'webhook' | 'event';
  cron?: string;
  interval?: number;
  webhook?: string;
  webhookId?: string;
  event?: string;
  target?: string;
  threshold?: number;
}

/** A workflow definition. */
export interface Workflow {
  [key: string]: unknown;
  id?: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  trigger?: WorkflowTrigger;
  enabled?: boolean;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Runtime variable context passed between workflow steps. */
export interface WorkflowContext extends Record<string, unknown> {
  _workflow?: { id?: string; name?: string };
  _run?: { id?: string; trigger?: string };
  _timestamp?: string;
  authToken?: string;
}

/** A registered workflow action. */
export interface WorkflowAction {
  [key: string]: unknown;
  description: string;
  category?: string;
  params?: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: WorkflowContext) => Promise<unknown>;
}

/** A condition expression or structured condition. */
export interface WorkflowCondition {
  [key: string]: unknown;
  all?: string[];
  any?: string[];
  left?: string;
  operator?: string;
  right?: unknown;
}

/** Result returned by a condition evaluation. */
export interface ConditionEvaluation {
  [key: string]: unknown;
  passed: boolean;
  details: string;
}

/** A single step result stored on a workflow run. */
export interface WorkflowStepResult {
  [key: string]: unknown;
  index: number;
  type: string;
  name: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'skipped' | 'failed';
  result: unknown;
  error: string | null;
}

/** A workflow execution run record. */
export interface WorkflowRun {
  [key: string]: unknown;
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  trigger: string;
  userId: string;
  startedAt: string;
  completedAt: string | null;
  stepsCompleted: number;
  totalSteps: number;
  steps: WorkflowStepResult[];
  context: Record<string, unknown>;
  error: string | null;
  result: Record<string, unknown> | null;
}

/** Options accepted by {@link runWorkflow}. */
export interface WorkflowRunOptions {
  [key: string]: unknown;
  trigger?: string;
  initialContext?: Record<string, unknown>;
  authToken?: string;
  userId?: string;
  onProgress?: (event: Record<string, unknown>) => void;
  isCancelled?: () => boolean;
}

/** Validation result returned by {@link validateWorkflow}. */
export interface WorkflowValidation {
  [key: string]: unknown;
  valid: boolean;
  errors: string[];
}

/** Persistence interface used by the workflow store. */
export interface WorkflowStore {
  saveWorkflow(workflow: Record<string, unknown>): Promise<Record<string, unknown>>;
  getWorkflow(id: string): Promise<Record<string, unknown> | null>;
  listWorkflows(): Promise<Record<string, unknown>[]>;
  deleteWorkflow(id: string): Promise<boolean>;
  findWorkflowByName(name: string): Promise<Record<string, unknown> | null>;
  saveRun(run: Record<string, unknown>): Promise<Record<string, unknown>>;
  getRun(workflowId: string, runId: string): Promise<Record<string, unknown> | null>;
  listRuns(workflowId: string, limit?: number): Promise<Record<string, unknown>[]>;
  updateRun(run: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** Facebook HTTP client (Story 13.4, 13.9, 13.10). */
export declare class FacebookClient {
  constructor(deps?: Record<string, unknown>);
  request(method: string, url: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  ensureTokens(accountId?: string | null, cookies?: string | Record<string, string>, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  requestGraphQl(docId: string, variables?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  clearTokenCache(): void;
  close(): Promise<void>;
}

/** Hybrid Facebook scraper engine (Story 13.3, 13.5–13.10). */
export declare class FacebookCrawler {
  constructor(deps?: Record<string, unknown>);
  start(command: { action: string; args?: Record<string, unknown> }): Promise<unknown>;
  init(): Promise<void>;
  cleanup(): Promise<void>;
  search(args: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  listActions(): Array<{ action: string; [key: string]: unknown }>;
  registerAction(action: string | Record<string, unknown>, handler?: unknown, descriptor?: Record<string, unknown>): void;
}

/** Facebook browser automation actions (Story 13.9). */
export declare class FacebookActions {
  constructor(deps?: Record<string, unknown>);
  like(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  comment(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  post(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  share(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  messengerShare(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  shareLinkByUid(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  joinGroup(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
  sendFriendRequest(args?: Record<string, unknown>, session?: Record<string, unknown>): Promise<unknown>;
}
