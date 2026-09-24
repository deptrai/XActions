// by nichxbt
'use client';

import React, { useState } from 'react';
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Check, X } from 'lucide-react';
import { api } from '@/lib/api';

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  condition: string;
  action: string;
  enabled: boolean;
  lastFired?: string;
  fireCount: number;
}

const TRIGGER_OPTIONS = [
  'new_follower', 'unfollow', 'mention', 'keyword_match', 'schedule', 'dm_received', 'like_received', 'repost',
];

const ACTION_OPTIONS = [
  'send_dm', 'follow_back', 'like_post', 'repost', 'add_to_list', 'notify', 'block', 'mute', 'tag_crm',
];

const SEEDED_RULES: AutomationRule[] = [
  { id: 'r1', name: 'Auto-follow back quality accounts', trigger: 'new_follower', condition: 'followers > 100', action: 'follow_back', enabled: true, lastFired: '5m ago', fireCount: 234 },
  { id: 'r2', name: 'DM welcome message', trigger: 'new_follower', condition: 'always', action: 'send_dm', enabled: true, lastFired: '12m ago', fireCount: 189 },
  { id: 'r3', name: 'Block bot accounts', trigger: 'new_follower', condition: 'bot_score > 0.8', action: 'block', enabled: false, fireCount: 0 },
  { id: 'r4', name: 'Like mentions', trigger: 'mention', condition: 'sentiment = positive', action: 'like_post', enabled: true, lastFired: '1h ago', fireCount: 56 },
  { id: 'r5', name: 'CRM tag influencers', trigger: 'new_follower', condition: 'followers > 10000', action: 'tag_crm', enabled: true, lastFired: '2h ago', fireCount: 23 },
];

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>(SEEDED_RULES);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', trigger: 'new_follower', condition: '', action: 'send_dm' });

  const toggleRule = async (id: string) => {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
    const rule = rules.find((r) => r.id === id);
    if (rule) await api('PATCH', `/api/automations/${id}`, { body: { enabled: !rule.enabled } }).catch(() => {});
  };

  const deleteRule = async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    await api('DELETE', `/api/automations/${id}`).catch(() => {});
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const rule: AutomationRule = { id: `r${Date.now()}`, ...form, enabled: true, fireCount: 0 };
    setRules((prev) => [...prev, rule]);
    setIsCreating(false);
    setForm({ name: '', trigger: 'new_follower', condition: '', action: 'send_dm' });
    await api('POST', '/api/automations', { body: rule }).catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-950/60 text-yellow-600">
              <Zap className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Automation Rules</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Event-driven rules — trigger → condition → action.
          </p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /><span>New Rule</span>
        </button>
      </div>

      {isCreating && (
        <div className="p-4 rounded-xl border border-yellow-200 dark:border-yellow-800/40 bg-yellow-50 dark:bg-yellow-950/40 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Automation Rule</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rule name..." className="col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500" />
            <select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              {TRIGGER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input type="text" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} placeholder="Condition (optional)..." className="col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-medium">Create</button>
            <button onClick={() => setIsCreating(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className={`p-4 rounded-xl border transition-all ${rule.enabled ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900' : 'border-slate-100 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/50 opacity-70'}`}>
            <div className="flex items-center gap-4">
              <button onClick={() => toggleRule(rule.id)} className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                {rule.enabled ? <ToggleRight className="w-6 h-6 text-yellow-500" /> : <ToggleLeft className="w-6 h-6" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{rule.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rule.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                    {rule.enabled ? 'active' : 'disabled'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{rule.trigger}</span>
                  <span>→</span>
                  <span className="text-slate-400">{rule.condition || 'always'}</span>
                  <span>→</span>
                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{rule.action}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{rule.fireCount} fires</p>
                {rule.lastFired && <p className="text-xs text-slate-400">{rule.lastFired}</p>}
              </div>
              <button onClick={() => deleteRule(rule.id)} className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
