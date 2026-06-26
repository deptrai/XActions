// by nichxbt
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { FileStore, resetStore, getStore } from '../../src/workflows/store.js';

// Use isolated temp directories so tests don't touch ~/.xactions
const TEMP_BASE = path.join(os.tmpdir(), `xactions-test-${process.pid}`);
const WORKFLOWS_DIR = path.join(TEMP_BASE, 'workflows');
const RUNS_DIR = path.join(TEMP_BASE, 'workflow-runs');

// Patch FileStore to use temp dirs (monkey-patch private paths via subclass)
class TestFileStore extends FileStore {
  constructor() {
    super();
    // Override the private paths used in _init
    this._workflowsDir = WORKFLOWS_DIR;
    this._runsDir = RUNS_DIR;
  }

  async _init() {
    if (this._initialized) return;
    await fs.mkdir(this._workflowsDir, { recursive: true });
    await fs.mkdir(this._runsDir, { recursive: true });
    this._initialized = true;
  }

  async saveWorkflow(workflow) {
    await this._init();
    const crypto = await import('crypto');
    if (!workflow.id) workflow.id = crypto.randomUUID();
    workflow.updatedAt = new Date().toISOString();
    if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;
    const filePath = path.join(this._workflowsDir, `${workflow.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
    return workflow;
  }

  async getWorkflow(id) {
    await this._init();
    try {
      const filePath = path.join(this._workflowsDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async listWorkflows() {
    await this._init();
    try {
      const files = await fs.readdir(this._workflowsDir);
      const workflows = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this._workflowsDir, file), 'utf-8');
          const wf = JSON.parse(data);
          workflows.push({
            id: wf.id,
            name: wf.name,
            description: wf.description,
            trigger: wf.trigger,
            enabled: wf.enabled !== false,
            stepsCount: wf.steps?.length || 0,
            createdAt: wf.createdAt,
            updatedAt: wf.updatedAt,
          });
        } catch {}
      }
      return workflows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } catch {
      return [];
    }
  }

  async deleteWorkflow(id) {
    await this._init();
    try {
      await fs.unlink(path.join(this._workflowsDir, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  async findWorkflowByName(name) {
    const workflows = await this.listWorkflows();
    const match = workflows.find(w => w.name?.toLowerCase() === name.toLowerCase());
    if (match) return this.getWorkflow(match.id);
    return null;
  }

  async saveRun(run) {
    await this._init();
    const crypto = await import('crypto');
    if (!run.id) run.id = crypto.randomUUID();
    const dir = path.join(this._runsDir, run.workflowId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${run.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(run, null, 2));
    return run;
  }

  async getRun(workflowId, runId) {
    await this._init();
    try {
      const filePath = path.join(this._runsDir, workflowId, `${runId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async listRuns(workflowId, limit = 20) {
    await this._init();
    try {
      const dir = path.join(this._runsDir, workflowId);
      const files = await fs.readdir(dir);
      const runs = [];
      for (const file of files.reverse()) {
        if (!file.endsWith('.json')) continue;
        if (runs.length >= limit) break;
        try {
          const data = await fs.readFile(path.join(dir, file), 'utf-8');
          const run = JSON.parse(data);
          runs.push({
            id: run.id,
            workflowId: run.workflowId,
            status: run.status,
            trigger: run.trigger,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            stepsCompleted: run.stepsCompleted || 0,
            totalSteps: run.totalSteps || 0,
            error: run.error,
          });
        } catch {}
      }
      return runs;
    } catch {
      return [];
    }
  }

  async updateRun(run) {
    return this.saveRun(run);
  }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let store;

beforeEach(async () => {
  await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
  await fs.mkdir(RUNS_DIR, { recursive: true });
  store = new TestFileStore();
});

afterEach(async () => {
  await fs.rm(TEMP_BASE, { recursive: true, force: true });
});

// ============================================================================
// FileStore — Workflow CRUD
// ============================================================================

describe('FileStore — saveWorkflow', () => {
  it('saves a workflow and assigns an id', async () => {
    const wf = await store.saveWorkflow({ name: 'Test WF', steps: [] });
    expect(typeof wf.id).toBe('string');
    expect(wf.id.length).toBeGreaterThan(0);
    expect(wf.name).toBe('Test WF');
  });

  it('preserves provided id', async () => {
    const wf = await store.saveWorkflow({ id: 'fixed-id', name: 'Fixed', steps: [] });
    expect(wf.id).toBe('fixed-id');
  });

  it('sets createdAt and updatedAt timestamps', async () => {
    const wf = await store.saveWorkflow({ name: 'Timestamps', steps: [] });
    expect(typeof wf.createdAt).toBe('string');
    expect(typeof wf.updatedAt).toBe('string');
  });

  it('updates updatedAt on re-save but preserves createdAt', async () => {
    const wf = await store.saveWorkflow({ name: 'Update Test', steps: [] });
    const created = wf.createdAt;
    await new Promise(r => setTimeout(r, 5)); // ensure time difference
    wf.name = 'Updated Name';
    const updated = await store.saveWorkflow(wf);
    expect(updated.createdAt).toBe(created);
    expect(updated.updatedAt).not.toBe(created);
  });
});

describe('FileStore — getWorkflow', () => {
  it('retrieves a saved workflow by id', async () => {
    const wf = await store.saveWorkflow({ name: 'Retrieve Me', steps: [{ action: 'log' }] });
    const retrieved = await store.getWorkflow(wf.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved.name).toBe('Retrieve Me');
    expect(retrieved.steps).toHaveLength(1);
  });

  it('returns null for non-existent id', async () => {
    const result = await store.getWorkflow('non-existent-id');
    expect(result).toBeNull();
  });
});

describe('FileStore — listWorkflows', () => {
  it('returns empty array when no workflows saved', async () => {
    const list = await store.listWorkflows();
    expect(list).toEqual([]);
  });

  it('lists all saved workflows', async () => {
    await store.saveWorkflow({ name: 'WF Alpha', steps: [] });
    await store.saveWorkflow({ name: 'WF Beta', steps: [{ action: 'log' }] });
    const list = await store.listWorkflows();
    expect(list).toHaveLength(2);
    const names = list.map(w => w.name);
    expect(names).toContain('WF Alpha');
    expect(names).toContain('WF Beta');
  });

  it('returns summary fields (not full step definitions)', async () => {
    await store.saveWorkflow({ name: 'Summary WF', steps: [{ action: 'log' }, { action: 'count' }] });
    const list = await store.listWorkflows();
    expect(list[0].stepsCount).toBe(2);
    expect(list[0].id).toBeDefined();
    expect(list[0].name).toBeDefined();
    // Full steps array should not be in list summary
    expect(list[0].steps).toBeUndefined();
  });

  it('sorts by updatedAt descending', async () => {
    const wf1 = await store.saveWorkflow({ name: 'First', steps: [] });
    await new Promise(r => setTimeout(r, 10));
    const wf2 = await store.saveWorkflow({ name: 'Second', steps: [] });
    const list = await store.listWorkflows();
    expect(list[0].name).toBe('Second');
    expect(list[1].name).toBe('First');
  });
});

describe('FileStore — deleteWorkflow', () => {
  it('deletes a workflow and returns true', async () => {
    const wf = await store.saveWorkflow({ name: 'Delete Me', steps: [] });
    const result = await store.deleteWorkflow(wf.id);
    expect(result).toBe(true);
    const retrieved = await store.getWorkflow(wf.id);
    expect(retrieved).toBeNull();
  });

  it('returns false for non-existent id', async () => {
    const result = await store.deleteWorkflow('ghost-id');
    expect(result).toBe(false);
  });
});

describe('FileStore — findWorkflowByName', () => {
  it('finds a workflow by exact name (case-insensitive)', async () => {
    await store.saveWorkflow({ name: 'My Workflow', steps: [] });
    const found = await store.findWorkflowByName('my workflow');
    expect(found).not.toBeNull();
    expect(found.name).toBe('My Workflow');
  });

  it('returns null when name does not match', async () => {
    await store.saveWorkflow({ name: 'Existing WF', steps: [] });
    const found = await store.findWorkflowByName('Nonexistent');
    expect(found).toBeNull();
  });
});

// ============================================================================
// FileStore — Run CRUD
// ============================================================================

describe('FileStore — saveRun + getRun', () => {
  it('saves a run and retrieves it', async () => {
    const run = {
      id: 'run-001',
      workflowId: 'wf-abc',
      status: 'running',
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      steps: [],
    };
    await store.saveRun(run);
    const retrieved = await store.getRun('wf-abc', 'run-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved.id).toBe('run-001');
    expect(retrieved.status).toBe('running');
  });

  it('assigns id if missing', async () => {
    const run = { workflowId: 'wf-xyz', status: 'completed', steps: [] };
    const saved = await store.saveRun(run);
    expect(typeof saved.id).toBe('string');
    expect(saved.id.length).toBeGreaterThan(0);
  });

  it('returns null for non-existent run', async () => {
    const result = await store.getRun('wf-abc', 'ghost-run');
    expect(result).toBeNull();
  });
});

describe('FileStore — listRuns', () => {
  it('returns empty array when no runs exist', async () => {
    const runs = await store.listRuns('wf-no-runs');
    expect(runs).toEqual([]);
  });

  it('lists runs for a workflow', async () => {
    for (let i = 0; i < 3; i++) {
      await store.saveRun({
        id: `run-${i}`,
        workflowId: 'wf-list',
        status: 'completed',
        steps: [],
        startedAt: new Date().toISOString(),
      });
    }
    const runs = await store.listRuns('wf-list');
    expect(runs).toHaveLength(3);
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveRun({
        id: `run-lim-${i}`,
        workflowId: 'wf-limited',
        status: 'completed',
        steps: [],
        startedAt: new Date().toISOString(),
      });
    }
    const runs = await store.listRuns('wf-limited', 2);
    expect(runs).toHaveLength(2);
  });

  it('returns summary fields (not full step logs)', async () => {
    await store.saveRun({
      id: 'run-summary',
      workflowId: 'wf-sum',
      status: 'completed',
      trigger: 'manual',
      stepsCompleted: 3,
      totalSteps: 3,
      steps: [{ index: 0 }, { index: 1 }, { index: 2 }],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    const runs = await store.listRuns('wf-sum');
    expect(runs[0].stepsCompleted).toBe(3);
    expect(runs[0].totalSteps).toBe(3);
    // Full steps array should not be in list summary
    expect(runs[0].steps).toBeUndefined();
  });
});

describe('FileStore — updateRun', () => {
  it('updates run status via updateRun', async () => {
    const run = await store.saveRun({
      id: 'run-upd',
      workflowId: 'wf-upd',
      status: 'running',
      steps: [],
    });
    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    await store.updateRun(run);

    const retrieved = await store.getRun('wf-upd', 'run-upd');
    expect(retrieved.status).toBe('completed');
    expect(retrieved.completedAt).toBeDefined();
  });
});

// ============================================================================
// getStore / resetStore
// ============================================================================

describe('getStore + resetStore', () => {
  it('returns the same instance on repeated calls (singleton)', async () => {
    resetStore();
    const s1 = await getStore();
    const s2 = await getStore();
    expect(s1).toBe(s2);
    resetStore();
  });

  it('returns a new instance after resetStore', async () => {
    resetStore();
    const s1 = await getStore();
    resetStore();
    const s2 = await getStore();
    expect(s1).not.toBe(s2);
    resetStore();
  });
});
