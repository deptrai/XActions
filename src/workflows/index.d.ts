import type { Workflow, WorkflowRun, WorkflowRunOptions, WorkflowValidation, WorkflowAction, WorkflowCondition, ConditionEvaluation } from '../types/xactions.js';

export interface WorkflowsModule {
  create(definition: Workflow): Promise<Workflow>;
  get(idOrName: string): Promise<Workflow | null>;
  list(): Promise<Workflow[]>;
  update(id: string, updates: Partial<Workflow>): Promise<Workflow>;
  remove(id: string): Promise<boolean>;
  run(idOrNameOrDef: string | Workflow, options?: WorkflowRunOptions): Promise<WorkflowRun>;
  runs(workflowId: string, limit?: number): Promise<Record<string, unknown>[]>;
  getRun(workflowId: string, runId: string): Promise<Record<string, unknown> | null>;
  initTriggers(options?: WorkflowRunOptions): void;
  shutdown(): Promise<void>;
  validate(definition: Workflow): WorkflowValidation;
  listActions(): WorkflowAction[];
  registerAction(name: string, action: WorkflowAction): void;
  executeAction(name: string, params: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
  evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>): Promise<ConditionEvaluation>;
  getAvailableOperators(): string[];
  triggerManager: Record<string, (webhookId: string, payload: unknown) => boolean>;
}

export function create(definition: Workflow): Promise<Workflow>;
export function get(idOrName: string): Promise<Workflow | null>;
export function list(): Promise<Workflow[]>;
export function update(id: string, updates: Partial<Workflow>): Promise<Workflow>;
export function remove(id: string): Promise<boolean>;
export function run(idOrNameOrDef: string | Workflow, options?: WorkflowRunOptions): Promise<WorkflowRun>;
export function runs(workflowId: string, limit?: number): Promise<Record<string, unknown>[]>;
export function getRun(workflowId: string, runId: string): Promise<Record<string, unknown> | null>;
export function initTriggers(options?: WorkflowRunOptions): void;
export function shutdown(): Promise<void>;
export function validate(definition: Workflow): WorkflowValidation;
export function listActions(): WorkflowAction[];
export function registerAction(name: string, action: WorkflowAction): void;
export function executeAction(name: string, params: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown>;
export function evaluateCondition(condition: WorkflowCondition, context: Record<string, unknown>): Promise<ConditionEvaluation>;
export function getAvailableOperators(): string[];
export const triggerManager: Record<string, (webhookId: string, payload: unknown) => boolean>;

declare const workflows: WorkflowsModule;
export default workflows;
