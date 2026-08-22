export interface JobConfig {
  name: string;
  cron: string;
  command?: string;
  action?: string;
  args?: string[];
  enabled?: boolean;
  maxRetries?: number;
  timeout?: number;
}

export interface JobStatus {
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  createdAt: string;
}

export interface JobResult {
  status: string;
  name?: string;
  error?: string;
}

export class Scheduler {
  constructor(options?: Record<string, unknown>);

  addJob(config: JobConfig): JobConfig;
  removeJob(name: string): JobResult;
  enableJob(name: string): JobResult;
  disableJob(name: string): JobResult;
  listJobs(): JobStatus[];
  getJobHistory(name: string, limit?: number): Promise<Record<string, unknown>[]>;
  runJobNow(name: string): Promise<JobResult>;
  start(): void;
  stop(): void;
}

export function getScheduler(): Scheduler;

export const JOB_TEMPLATES: Record<string, unknown>[];

declare const _default: Scheduler;
export default _default;
