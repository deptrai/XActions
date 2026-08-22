export class ThoughtLeaderAgent {
  constructor(config?: Record<string, unknown>);
  config: Record<string, unknown>;
  running: boolean;
  llm: Record<string, (...args: unknown[]) => unknown>;
  scheduler: Record<string, (...args: unknown[]) => unknown>;
  db: Record<string, (...args: unknown[]) => unknown>;

  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Record<string, unknown>;

  static loadConfig(configPath: string): Record<string, unknown>;
}

declare const _default: typeof ThoughtLeaderAgent;
export default _default;
