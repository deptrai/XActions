/**
 * MCP Server Tool Execution and Runtime Modes (Story 52.3 / Epic 52)
 */
export type ToolMode = 'compact' | 'full';

export interface McpToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, unknown>;
  default?: unknown;
  [key: string]: unknown;
}

export interface McpToolSchema {
  type: 'object';
  properties?: Record<string, McpToolProperty | Record<string, unknown>>;
  required?: string[];
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
}

export interface DomainActionDispatchConfig {
  targetTool?: string;
  legacyTool?: string;
  platform?: string;
  action?: string;
  requiredArgs?: string[];
  mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  handler?: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

export type DomainDispatchMap = Record<string, Record<string, DomainActionDispatchConfig>>;

export const TOOLS: McpToolDefinition[];
export const DOMAIN_TOOLS: McpToolDefinition[];
export const DOMAIN_DISPATCH_MAP: DomainDispatchMap;

export function getDomainTools(): McpToolDefinition[];
export function getAllTools(): McpToolDefinition[];
export function getToolMode(): ToolMode;
export function setToolMode(mode: ToolMode | string | null): void;
export function resetToolMode(): void;
export function getActiveTools(mode?: ToolMode | string | null): McpToolDefinition[];
export function resolveCliToolMode(argv?: string[]): ToolMode | null;
export function resolveEnvToolMode(env?: Record<string, string | undefined>): ToolMode | null;
export function setLocalTools(tools: unknown): void;

export function main(...args: unknown[]): Promise<void>;
export function createMcpServer(...args: unknown[]): unknown;
export function initializeBackend(...args: unknown[]): Promise<unknown>;
export function executeTool(name: string, args?: Record<string, unknown>, extra?: unknown): Promise<unknown>;
export function executeFacebookAutomateTool(...args: unknown[]): Promise<unknown>;
export function executeFacebookEpic4Tool(...args: unknown[]): Promise<unknown>;
export function executeFacebookScrapeTool(...args: unknown[]): Promise<unknown>;
export function executeFacebookListAccounts(...args: unknown[]): Promise<unknown>;
export function executeActionListTool(...args: unknown[]): Promise<unknown>;
export function executeCrawlPostTool(...args: unknown[]): Promise<unknown>;
export function executeCrawlCommentsTreeTool(...args: unknown[]): Promise<unknown>;
export function executeScrapeTool(args?: Record<string, unknown>): Promise<unknown>;
export function executeSocialFindProfilesTool(...args: unknown[]): Promise<unknown>;
export function startHttpTransport(options?: Record<string, unknown>): Promise<unknown>;

declare const _default: unknown;
export default _default;
