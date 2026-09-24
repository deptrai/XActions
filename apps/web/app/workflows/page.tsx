// by nichxbt
'use client';

import React, { useState } from 'react';
import { Workflow, Plus, Trash2, ArrowUp, ArrowDown, Play, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface WorkflowStep {
  id: string;
  type: string;
  label: string;
  config: Record<string, string>;
  expanded?: boolean;
}

interface WorkflowDef {
  id: string;
  name: string;
  trigger: string;
  status: 'active' | 'paused' | 'draft';
  steps: WorkflowStep[];
  lastRun?: string;
  runCount: number;
}

const STEP_TYPES = [
  { value: 'scrape', label: 'Scrape Data' },
  { value: 'filter', label: 'Filter / Condition' },
  { value: 'transform', label: 'Transform Data' },
  { value: 'post', label: 'Post Content' },
  { value: 'notify', label: 'Send Notification' },
  { value: 'wait', label: 'Wait / Delay' },
  { value: 'webhook', label: 'Call Webhook' },
  { value: 'store', label: 'Store to DB' },
];

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual Trigger' },
  { value: 'cron', label: 'Scheduled (Cron)' },
  { value: 'event', label: 'Event-based' },
  { value: 'webhook', label: 'Webhook' },
];

const SEEDED_WORKFLOWS: WorkflowDef[] = [
  {
    id: 'wf1', name: 'Daily Trending Scraper', trigger: 'cron', status: 'active', runCount: 47, lastRun: '2h ago',
    steps: [
      { id: 's1', type: 'scrape', label: 'Scrape Trending Topics', config: { platform: 'x', limit: '50' } },
      { id: 's2', type: 'filter', label: 'Filter min engagement', config: { minLikes: '100' } },
      { id: 's3', type: 'store', label: 'Save to trends DB', config: { table: 'trending' } },
      { id: 's4', type: 'notify', label: 'Notify Slack', config: { channel: '#trends' } },
    ],
  },
  {
    id: 'wf2', name: 'New Follower Welcome', trigger: 'event', status: 'active', runCount: 12, lastRun: '30m ago',
    steps: [
      { id: 's1', type: 'filter', label: 'Check follower quality', config: { minFollowers: '50' } },
      { id: 's2', type: 'post', label: 'Send welcome DM', config: { template: 'welcome_v2' } },
    ],
  },
  {
    id: 'wf3', name: 'Weekly Analytics Report', trigger: 'cron', status: 'paused', runCount: 8, lastRun: '5d ago',
    steps: [
      { id: 's1', type: 'scrape', label: 'Fetch analytics', config: { period: '7d' } },
      { id: 's2', type: 'transform', label: 'Generate report', config: { format: 'pdf' } },
      { id: 's3', type: 'webhook', label: 'Send to webhook', config: { url: 'https://hooks.example.com/report' } },
    ],
  },
];

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>(SEEDED_WORKFLOWS);
  const [selected, setSelected] = useState<WorkflowDef | null>(SEEDED_WORKFLOWS[0]);
  const [newName, setNewName] = useState('');
  const [newTrigger, setNewTrigger] = useState('manual');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const addStep = () => {
    if (!selected) return;
    const newStep: WorkflowStep = {
      id: `s${Date.now()}`,
      type: 'scrape',
      label: 'New Step',
      config: {},
    };
    setSelected({ ...selected, steps: [...selected.steps, newStep] });
  };

  const removeStep = (stepId: string) => {
    if (!selected) return;
    setSelected({ ...selected, steps: selected.steps.filter((s) => s.id !== stepId) });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    if (!selected) return;
    const steps = [...selected.steps];
    const tmp = steps[idx];
    steps[idx] = steps[idx + dir];
    steps[idx + dir] = tmp;
    setSelected({ ...selected, steps });
  };

  const toggleExpand = (stepId: string) => {
    if (!selected) return;
    setSelected({
      ...selected,
      steps: selected.steps.map((s) => s.id === stepId ? { ...s, expanded: !s.expanded } : s),
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    setIsSaving(true);
    await api('POST', '/api/workflows', { body: selected }).catch(() => {});
    setIsSaving(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const wf: WorkflowDef = {
      id: `wf${Date.now()}`,
      name: newName.trim(),
      trigger: newTrigger,
      status: 'draft',
      steps: [],
      runCount: 0,
    };
    setWorkflows((prev) => [...prev, wf]);
    setSelected(wf);
    setNewName('');
    setIsCreating(false);
    await api('POST', '/api/workflows', { body: wf }).catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600">
              <Workflow className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Workflow Builder</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Build multi-step automation pipelines — scrape, filter, post, notify.
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          <span>New Workflow</span>
        </button>
      </div>

      {/* Create Form */}
      {isCreating && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-950/40 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create New Workflow</h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Workflow name..."
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              {TRIGGER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">Create</button>
            <button onClick={() => setIsCreating(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workflow List */}
        <div className="space-y-2">
          {workflows.map((wf) => (
            <button
              key={wf.id}
              onClick={() => setSelected(wf)}
              className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                selected?.id === wf.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{wf.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[wf.status]}`}>{wf.status}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                <span>{wf.trigger}</span>
                <span>·</span>
                <span>{wf.steps.length} steps</span>
                {wf.lastRun && <><span>·</span><span>{wf.lastRun}</span></>}
              </div>
            </button>
          ))}
        </div>

        {/* Step Editor */}
        {selected && (
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{selected.name}</h2>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-60">
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Play className="w-3.5 h-3.5" />
                  <span>Run</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {selected.steps.map((step, idx) => (
                <div key={step.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <div className="flex items-center gap-3 p-3.5">
                    <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <select
                        value={step.type}
                        onChange={(e) => setSelected({ ...selected, steps: selected.steps.map((s) => s.id === step.id ? { ...s, type: e.target.value } : s) })}
                        className="text-xs font-medium bg-transparent text-slate-600 dark:text-slate-400 focus:outline-none"
                      >
                        {STEP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(e) => setSelected({ ...selected, steps: selected.steps.map((s) => s.id === step.id ? { ...s, label: e.target.value } : s) })}
                        className="block w-full text-sm font-semibold text-slate-900 dark:text-white bg-transparent focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => moveStep(idx, 1)} disabled={idx === selected.steps.length - 1} className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => toggleExpand(step.id)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                        {step.expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => removeStep(step.id)} className="p-1 rounded text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  {step.expanded && (
                    <div className="px-4 pb-3 border-t border-slate-100 dark:border-slate-800">
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {Object.entries(step.config).map(([k, v]) => (
                          <div key={k} className="space-y-1">
                            <label className="text-xs text-slate-500">{k}</label>
                            <input type="text" value={v} className="w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={addStep}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 hover:border-slate-300 dark:hover:border-slate-700 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Step</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
