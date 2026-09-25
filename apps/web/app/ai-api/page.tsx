// by nichxbt
'use client';

import React, { useState } from 'react';
import { Code2, Play, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface Endpoint {
  method: string;
  path: string;
  description: string;
  params?: { name: string; type: string; required: boolean }[];
}

const ENDPOINTS: Endpoint[] = [
  { method: 'POST', path: '/api/ai/generate', description: 'Generate text with AI model', params: [{ name: 'prompt', type: 'string', required: true }, { name: 'model', type: 'string', required: false }, { name: 'maxTokens', type: 'number', required: false }] },
  { method: 'POST', path: '/api/ai/classify', description: 'Classify content into categories', params: [{ name: 'text', type: 'string', required: true }, { name: 'categories', type: 'string[]', required: true }] },
  { method: 'POST', path: '/api/ai/score', description: 'Score content for viral potential', params: [{ name: 'content', type: 'string', required: true }] },
  { method: 'GET', path: '/api/ai/status', description: 'Get AI model status' },
  { method: 'POST', path: '/api/ai/persona', description: 'Generate persona response', params: [{ name: 'personaId', type: 'string', required: true }, { name: 'input', type: 'string', required: true }] },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  POST: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400',
};

export default function AiApiPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [testBody, setTestBody] = useState<Record<string, string>>({});

  const testEndpoint = async (ep: Endpoint) => {
    setTesting((prev) => new Set(prev).add(ep.path));
    try {
      const body = testBody[ep.path] ? JSON.parse(testBody[ep.path]) : {};
      const res = await api(ep.method as 'GET' | 'POST', ep.path, ep.method === 'POST' ? { body } : undefined);
      setTestResults((prev) => ({ ...prev, [ep.path]: JSON.stringify(res, null, 2).slice(0, 500) }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [ep.path]: `Error: ${String(e)}` }));
    } finally {
      setTesting((prev) => { const s = new Set(prev); s.delete(ep.path); return s; });
    }
  };

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(path);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600">
            <Code2 className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">AI API Explorer</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Explore and test AI endpoints — live request/response.
        </p>
      </div>

      <div className="space-y-3">
        {ENDPOINTS.map((ep) => (
          <div key={ep.path} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === ep.path ? null : ep.path)}
              className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${METHOD_COLORS[ep.method]}`}>{ep.method}</span>
              <span className="font-mono text-sm text-slate-900 dark:text-white flex-1 text-left">{ep.path}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); copyPath(ep.path); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); copyPath(ep.path); } }}
                className="p-1 rounded text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {copied === ep.path ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </span>
              {expanded === ep.path ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {expanded === ep.path && (
              <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <p className="text-xs text-slate-500 pt-3">{ep.description}</p>
                {ep.params && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Parameters:</p>
                    {ep.params.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-slate-700 dark:text-slate-300">{p.name}</span>
                        <span className="text-slate-400">{p.type}</span>
                        {p.required && <span className="text-red-400">required</span>}
                      </div>
                    ))}
                  </div>
                )}
                {ep.method === 'POST' && (
                  <textarea
                    value={testBody[ep.path] || '{}'}
                    onChange={(e) => setTestBody((prev) => ({ ...prev, [ep.path]: e.target.value }))}
                    placeholder='{"prompt": "test"}'
                    rows={3}
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  />
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testEndpoint(ep)}
                    disabled={testing.has(ep.path)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
                  >
                    <Play className="w-3.5 h-3.5" /><span>{testing.has(ep.path) ? 'Testing...' : 'Test'}</span>
                  </button>
                </div>
                {testResults[ep.path] && (
                  <pre className="text-xs font-mono bg-slate-950 text-slate-300 p-3 rounded-lg overflow-x-auto">{testResults[ep.path]}</pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
