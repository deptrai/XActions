// by nichxbt
'use client';

import React, { useState } from 'react';
import { Bot, Play, Pause, RefreshCw, Plus, Settings, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Agent {
  id: string;
  name: string;
  persona: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  lastAction?: string;
  actionsToday: number;
  niche: string;
  model: string;
}

const SEEDED_AGENTS: Agent[] = [
  { id: 'ag1', name: 'thought-leader-01', persona: 'Tech Thought Leader', status: 'running', lastAction: 'Posted thread', actionsToday: 14, niche: 'AI/SaaS', model: 'claude-opus-5' },
  { id: 'ag2', name: 'engagement-bot-02', persona: 'Community Engager', status: 'running', lastAction: 'Liked 12 posts', actionsToday: 47, niche: 'Crypto', model: 'claude-haiku-4.5' },
  { id: 'ag3', name: 'content-curator-03', persona: 'Content Curator', status: 'paused', lastAction: 'Reposted article', actionsToday: 3, niche: 'Tech News', model: 'claude-sonnet-5' },
  { id: 'ag4', name: 'lead-finder-04', persona: 'B2B Lead Finder', status: 'stopped', actionsToday: 0, niche: 'Sales', model: 'gpt-4o' },
];

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400',
  stopped: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400',
};

export default function AgentPage() {
  const [agents, setAgents] = useState<Agent[]>(SEEDED_AGENTS);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: '', persona: '', niche: '', model: 'claude-haiku-4.5' });

  const toggleAgent = async (id: string) => {
    setAgents((prev) => prev.map((a) => a.id === id ? { ...a, status: a.status === 'running' ? 'paused' : 'running' } : a));
    await api('POST', `/api/agents/${id}/toggle`).catch(() => {});
  };

  const deleteAgent = async (id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    await api('DELETE', `/api/agents/${id}`).catch(() => {});
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const agent: Agent = { id: `ag${Date.now()}`, ...form, status: 'stopped', actionsToday: 0 };
    setAgents((prev) => [...prev, agent]);
    setIsCreating(false);
    setForm({ name: '', persona: '', niche: '', model: 'claude-haiku-4.5' });
    await api('POST', '/api/agents', { body: agent }).catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600">
              <Bot className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Agent Dashboard</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            AI-powered growth agents — personas, status, and controls.
          </p>
        </div>
        <button onClick={() => setIsCreating(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">
          <Plus className="w-4 h-4" /><span>New Agent</span>
        </button>
      </div>

      {isCreating && (
        <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50 dark:bg-indigo-950/40 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Agent</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agent name..." className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
            <input type="text" value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} placeholder="Persona..." className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
            <input type="text" value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} placeholder="Niche..." className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white" />
            <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
              <option value="claude-sonnet-5">Claude Sonnet 5</option>
              <option value="claude-opus-5">Claude Opus 5</option>
              <option value="gpt-4o">GPT-4o</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">Create</button>
            <button onClick={() => setIsCreating(false)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <div key={agent.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{agent.name}</p>
                  <p className="text-xs text-slate-500">{agent.persona}</p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[agent.status]}`}>{agent.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><p className="text-slate-400">Niche</p><p className="font-medium text-slate-700 dark:text-slate-300">{agent.niche}</p></div>
              <div><p className="text-slate-400">Model</p><p className="font-mono text-slate-700 dark:text-slate-300 truncate">{agent.model}</p></div>
              <div><p className="text-slate-400">Actions today</p><p className="font-bold text-slate-700 dark:text-slate-300">{agent.actionsToday}</p></div>
            </div>
            {agent.lastAction && <p className="text-xs text-slate-400">Last: {agent.lastAction}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => toggleAgent(agent.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${agent.status === 'running' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 hover:bg-emerald-200'}`}>
                {agent.status === 'running' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{agent.status === 'running' ? 'Pause' : 'Start'}</span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
                <Settings className="w-3.5 h-3.5" /><span>Config</span>
              </button>
              <button onClick={() => deleteAgent(agent.id)} className="p-1.5 rounded text-red-400 hover:text-red-600 ml-auto">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
