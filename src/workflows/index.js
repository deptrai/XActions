// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Workflows — Main Entry Point
 *
 * Usage:
 *   import workflows from './workflows/index.js';
 *
 *   // Create and run a workflow
 *   const workflow = await workflows.create({ name: 'My Workflow', steps: [...] });
 *   const run = await workflows.run(workflow.id);
 *
 *   // List workflows and runs
 *   const all = await workflows.list();
 *   const runs = await workflows.runs(workflow.id);
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { runWorkflow, validateWorkflow } from './engine.js';
import { getStore } from './store.js';
import triggerManager from './triggers.js';
import { listActions, registerAction, executeAction, closeBrowser } from './actions.js';
import { evaluateCondition, getAvailableOperators } from './conditions.js';

/**
 * @typedef {import('../types/xactions.js').Workflow} Workflow
 * @typedef {import('../types/xactions.js').WorkflowRun} WorkflowRun
 * @typedef {import('../types/xactions.js').WorkflowRunOptions} WorkflowRunOptions
 * @typedef {import('../types/xactions.js').WorkflowStore} WorkflowStore
 */

// ============================================================================
// High-Level Workflow API
// ============================================================================

/**
 * Create a new workflow
 *
 * @param {Workflow} definition
 * @returns {Promise<Workflow>}
 */
async function create(definition) {
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`);
  }

  const store = /** @type {WorkflowStore} */ (await getStore());
  const workflow = /** @type {Workflow} */ (await store.saveWorkflow({
    ...definition,
    enabled: definition.enabled !== false,
  }));

  // Register trigger if defined
  if (workflow.id && workflow.trigger && workflow.trigger.type !== 'manual') {
    await triggerManager.register(workflow.id, workflow.trigger);
  }

  return workflow;
}

/**
 * Get a workflow by ID or name
 *
 * @param {string} idOrName
 * @returns {Promise<Workflow | null>}
 */
async function get(idOrName) {
  const store = /** @type {WorkflowStore} */ (await getStore());
  let workflow = /** @type {Workflow | null} */ (await store.getWorkflow(idOrName));
  if (!workflow) {
    workflow = /** @type {Workflow | null} */ (await store.findWorkflowByName(idOrName));
  }
  return workflow;
}

/**
 * List all workflows
 *
 * @returns {Promise<Workflow[]>}
 */
async function list() {
  const store = /** @type {WorkflowStore} */ (await getStore());
  return /** @type {Workflow[]} */ (await store.listWorkflows());
}

/**
 * Update a workflow
 *
 * @param {string} id
 * @param {Partial<Workflow>} updates
 * @returns {Promise<Workflow>}
 */
async function update(id, updates) {
  const store = /** @type {WorkflowStore} */ (await getStore());
  const existing = /** @type {Workflow | null} */ (await store.getWorkflow(id));
  if (!existing) {
    throw new Error(`Workflow not found: ${id}`);
  }

  const updated = /** @type {Workflow} */ ({ ...existing, ...updates, id });
  const validation = validateWorkflow(updated);
  if (!validation.valid) {
    throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`);
  }

  // Re-register trigger if it changed
  if (updates.trigger) {
    await triggerManager.unregister(id);
    if (updated.trigger && updated.trigger.type !== 'manual') {
      await triggerManager.register(id, updated.trigger);
    }
  }

  return /** @type {Workflow} */ (await store.saveWorkflow(updated));
}

/**
 * Delete a workflow
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function remove(id) {
  const store = /** @type {WorkflowStore} */ (await getStore());
  await triggerManager.unregister(id);
  return store.deleteWorkflow(id);
}

/**
 * Run a workflow by ID, name, or definition object
 *
 * @param {string | Workflow} idOrNameOrDef
 * @param {WorkflowRunOptions} [options]
 * @returns {Promise<WorkflowRun>}
 */
async function run(idOrNameOrDef, options = {}) {
  let workflow;

  if (typeof idOrNameOrDef === 'object' && idOrNameOrDef !== null && idOrNameOrDef.steps) {
    // Direct workflow definition
    workflow = /** @type {Workflow} */ (idOrNameOrDef);
  } else {
    workflow = await get(/** @type {string} */ (idOrNameOrDef));
    if (!workflow) {
      throw new Error(`Workflow not found: ${idOrNameOrDef}`);
    }
  }

  return runWorkflow(workflow, options);
}

/**
 * Get execution runs for a workflow
 *
 * @param {string} workflowId
 * @param {number} [limit]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function runs(workflowId, limit = 20) {
  const store = /** @type {WorkflowStore} */ (await getStore());
  return store.listRuns(workflowId, limit);
}

/**
 * Get a specific run
 *
 * @param {string} workflowId
 * @param {string} runId
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getRun(workflowId, runId) {
  const store = /** @type {WorkflowStore} */ (await getStore());
  return store.getRun(workflowId, runId);
}

/**
 * Initialize trigger listener (connects triggers to the run engine)
 *
 * @param {WorkflowRunOptions} [options]
 */
function initTriggers(options = {}) {
  triggerManager.on('trigger', /** @type {(event: Record<string, unknown>) => Promise<void>} */ (async (event) => {
    const workflowId = String(event.workflowId);
    const type = String(event.type);
    console.log(`⚡ Workflow triggered: ${workflowId} (${type})`);
    try {
      const payload = /** @type {Record<string, unknown>} */ (event.payload || {});
      const result = await run(workflowId, {
        trigger: type,
        initialContext: payload,
        authToken: options.authToken || process.env.XACTIONS_SESSION_COOKIE,
      });
      console.log(`✅ Workflow ${workflowId} completed: ${result.status}`);
    } catch (error) {
      console.error(`❌ Workflow ${workflowId} failed:`, error instanceof Error ? error.message : String(error));
    }
  }));
}

/**
 * Shutdown workflows (clean up triggers, close browsers)
 */
async function shutdown() {
  await triggerManager.shutdown();
  await closeBrowser();
}

// ============================================================================
// Export
// ============================================================================

const workflows = {
  create,
  get,
  list,
  update,
  remove,
  run,
  runs,
  getRun,
  initTriggers,
  shutdown,
  validate: validateWorkflow,
  listActions,
  registerAction,
  executeAction,
  evaluateCondition,
  getAvailableOperators,
  triggerManager,
};

export {
  create,
  get,
  list,
  update,
  remove,
  run,
  runs,
  getRun,
  initTriggers,
  shutdown,
  validateWorkflow,
  listActions,
  registerAction,
  executeAction,
  evaluateCondition,
  getAvailableOperators,
  triggerManager,
};

export default workflows;
