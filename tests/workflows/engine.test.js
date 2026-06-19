// by nichxbt
import { describe, it, expect } from 'vitest';
import { validateWorkflow } from '../../src/workflows/engine.js';

// ============================================================================
// validateWorkflow
// ============================================================================

describe('validateWorkflow — valid inputs', () => {
  it('accepts a minimal valid workflow', () => {
    const result = validateWorkflow({
      name: 'Test Workflow',
      steps: [{ action: 'log' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a workflow with condition step', () => {
    const result = validateWorkflow({
      name: 'Condition Workflow',
      steps: [
        { condition: 'score > 100' },
        { action: 'log' },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a workflow with a manual trigger', () => {
    const result = validateWorkflow({
      name: 'Manual Trigger',
      steps: [{ action: 'log' }],
      trigger: { type: 'manual' },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a workflow with a schedule trigger + cron', () => {
    const result = validateWorkflow({
      name: 'Scheduled Workflow',
      steps: [{ action: 'log' }],
      trigger: { type: 'schedule', cron: '0 9 * * *' },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts a workflow with multiple steps of mixed types', () => {
    const result = validateWorkflow({
      name: 'Multi-step',
      steps: [
        { action: 'scrapeProfile', target: 'nichxbt' },
        { condition: 'profile.followers > 100' },
        { action: 'log', message: 'done' },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateWorkflow — invalid inputs', () => {
  it('rejects null', () => {
    const result = validateWorkflow(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects undefined', () => {
    const result = validateWorkflow(undefined);
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const result = validateWorkflow({ steps: [{ action: 'log' }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects non-string name', () => {
    const result = validateWorkflow({ name: 42, steps: [{ action: 'log' }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects missing steps', () => {
    const result = validateWorkflow({ name: 'No Steps' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('steps'))).toBe(true);
  });

  it('rejects non-array steps', () => {
    const result = validateWorkflow({ name: 'Bad Steps', steps: 'not-array' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('steps'))).toBe(true);
  });

  it('rejects a step with neither action nor condition', () => {
    const result = validateWorkflow({
      name: 'Bad Step',
      steps: [{ description: 'orphan step' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Step 0'))).toBe(true);
  });

  it('reports each invalid step individually', () => {
    const result = validateWorkflow({
      name: 'Multi Bad',
      steps: [
        { action: 'log' },           // valid
        { description: 'bad 1' },    // invalid
        { description: 'bad 2' },    // invalid
      ],
    });
    expect(result.valid).toBe(false);
    const stepErrors = result.errors.filter(e => e.includes('Step'));
    expect(stepErrors).toHaveLength(2);
  });

  it('rejects schedule trigger without cron field', () => {
    const result = validateWorkflow({
      name: 'Bad Schedule',
      steps: [{ action: 'log' }],
      trigger: { type: 'schedule' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cron'))).toBe(true);
  });

  it('rejects trigger object without type field', () => {
    const result = validateWorkflow({
      name: 'No Trigger Type',
      steps: [{ action: 'log' }],
      trigger: { cron: '* * * * *' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('type'))).toBe(true);
  });
});

describe('validateWorkflow — edge cases', () => {
  it('accepts an empty steps array', () => {
    // Empty steps is structurally valid (array exists, just no steps)
    const result = validateWorkflow({ name: 'Empty Steps', steps: [] });
    expect(result.valid).toBe(true);
  });

  it('string trigger is ignored (only object triggers are validated)', () => {
    // Non-object trigger is not validated — should still pass if name+steps ok
    const result = validateWorkflow({
      name: 'String Trigger',
      steps: [{ action: 'log' }],
      trigger: 'manual',
    });
    expect(result.valid).toBe(true);
  });
});
