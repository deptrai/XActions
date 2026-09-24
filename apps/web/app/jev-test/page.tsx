// by nichxbt
'use client';

import React, { useState } from 'react';
import { FlaskConical, Play, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';

interface TestResult {
  id: string;
  scenario: string;
  agent: string;
  status: 'pass' | 'fail' | 'running' | 'pending';
  duration?: number;
  logs: string[];
  timestamp: string;
}

interface TestScenario {
  id: string;
  name: string;
  description: string;
  agent: string;
}

const SCENARIOS: TestScenario[] = [
  { id: 'sc1', name: 'Follow-back decision', description: 'Agent decides whether to follow back based on follower quality', agent: 'persona-agent' },
  { id: 'sc2', name: 'Content scoring', description: 'Agent scores post content for viral potential', agent: 'optimizer-agent' },
  { id: 'sc3', name: 'Reply generation', description: 'Agent generates contextual reply to mention', agent: 'persona-agent' },
  { id: 'sc4', name: 'Rate limit handling', description: 'Agent gracefully handles 429 response', agent: 'scraper-agent' },
  { id: 'sc5', name: 'Session expiry', description: 'Agent detects and reports expired session', agent: 'monitor-agent' },
];

const INITIAL_RESULTS: TestResult[] = [
  { id: 'r1', scenario: 'Follow-back decision', agent: 'persona-agent', status: 'pass', duration: 1.24, logs: ['Input: follower=500, verified=false', 'Decision: follow_back (score=0.72)', 'Assertion: PASS'], timestamp: '10:15:32' },
  { id: 'r2', scenario: 'Content scoring', agent: 'optimizer-agent', status: 'pass', duration: 0.87, logs: ['Input: "AI is changing everything"', 'Score: 87/100', 'Assertion: PASS'], timestamp: '10:15:28' },
  { id: 'r3', scenario: 'Rate limit handling', agent: 'scraper-agent', status: 'fail', duration: 3.41, logs: ['Input: 429 response', 'Expected: backoff 60s', 'Got: immediate retry', 'Assertion: FAIL'], timestamp: '10:14:55' },
];

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  fail: <XCircle className="w-4 h-4 text-red-500" />,
  running: <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />,
  pending: <Clock className="w-4 h-4 text-slate-400" />,
};

export default function JevTestPage() {
  const [results, setResults] = useState<TestResult[]>(INITIAL_RESULTS);
  const [selected, setSelected] = useState<TestResult | null>(INITIAL_RESULTS[0]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ scenario: 'sc1', agent: 'persona-agent', params: '{}' });

  const runTest = async (scenarioId: string) => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId);
    if (!scenario) return;
    setRunning((prev) => new Set(prev).add(scenarioId));
    const pending: TestResult = {
      id: `r${Date.now()}`,
      scenario: scenario.name,
      agent: scenario.agent,
      status: 'running',
      logs: ['Starting test...'],
      timestamp: new Date().toLocaleTimeString(),
    };
    setResults((prev) => [pending, ...prev]);
    try {
      const res = await api<{ pass?: boolean; logs?: string[]; duration?: number }>(
        'POST', '/api/jev/test',
        { body: { scenario: scenario.name, agent: scenario.agent, params: JSON.parse(form.params || '{}') } }
      );
      const result: TestResult = {
        ...pending,
        status: res.ok && res.data?.pass ? 'pass' : 'fail',
        duration: res.data?.duration || Math.random() * 3,
        logs: res.data?.logs || ['Test completed'],
      };
      setResults((prev) => prev.map((r) => r.id === pending.id ? result : r));
      setSelected(result);
    } catch {
      setResults((prev) => prev.map((r) => r.id === pending.id ? { ...r, status: 'fail', logs: ['Network error'] } : r));
    } finally {
      setRunning((prev) => { const s = new Set(prev); s.delete(scenarioId); return s; });
    }
  };

  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-950/60 text-teal-600">
              <FlaskConical className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Jev Test Console</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Agent behavior testing — run scenarios, inspect logs.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{passCount} pass</span>
          <span className="text-red-500 font-semibold">{failCount} fail</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scenarios */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Test Scenarios</h2>
          <div className="space-y-2">
            {SCENARIOS.map((sc) => (
              <div key={sc.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{sc.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{sc.description}</p>
                    <p className="text-xs text-slate-400 mt-1 font-mono">{sc.agent}</p>
                  </div>
                  <button
                    onClick={() => runTest(sc.id)}
                    disabled={running.has(sc.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium disabled:opacity-60 shrink-0"
                  >
                    {running.has(sc.id) ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{running.has(sc.id) ? 'Running' : 'Run'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Results</h2>
          <div className="space-y-2">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                  selected?.id === r.id
                    ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {STATUS_ICONS[r.status]}
                  <span className="text-sm font-medium text-slate-900 dark:text-white flex-1 truncate">{r.scenario}</span>
                  <span className="text-xs text-slate-400 shrink-0">{r.timestamp}</span>
                  {r.duration && <span className="text-xs text-slate-500 shrink-0">{r.duration.toFixed(2)}s</span>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 ml-6">{r.agent}</p>
              </button>
            ))}
          </div>

          {/* Log Panel */}
          {selected && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Logs — {selected.scenario}</span>
                <span className={`text-xs font-bold ${selected.status === 'pass' ? 'text-emerald-400' : selected.status === 'fail' ? 'text-red-400' : 'text-blue-400'}`}>
                  {selected.status.toUpperCase()}
                </span>
              </div>
              <div className="p-4 font-mono text-xs space-y-1">
                {selected.logs.map((log, i) => (
                  <p key={i} className={`${log.includes('PASS') ? 'text-emerald-400' : log.includes('FAIL') ? 'text-red-400' : 'text-slate-400'}`}>
                    {log}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
