// by nichxbt
'use client';

import React, { useState } from 'react';
import { Puzzle, RefreshCw, Play, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

interface McpTool {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

const SEEDED_TOOLS: McpTool[] = [
  { name: 'x_scrape_profile', description: 'Scrape X/Twitter profile data', category: 'scraping', enabled: true },
  { name: 'x_scrape_followers', description: 'Scrape follower list', category: 'scraping', enabled: true },
  { name: 'x_post_tweet', description: 'Post a tweet', category: 'posting', enabled: true },
  { name: 'x_post_thread', description: 'Post a thread', category: 'posting', enabled: true },
  { name: 'x_send_dm', description: 'Send direct message', category: 'messaging', enabled: true },
  { name: 'x_get_analytics', description: 'Get engagement analytics', category: 'analytics', enabled: true },
  { name: 'x_persona_create', description: 'Create AI persona', category: 'agents', enabled: true },
  { name: 'x_persona_run', description: 'Run persona agent', category: 'agents', enabled: true },
  { name: 'x_graph_build', description: 'Build social graph', category: 'analysis', enabled: true },
  { name: 'x_osint_lookup', description: 'OSINT profile lookup', category: 'osint', enabled: false },
];

export default function McpPage() {
  const [tools, setTools] = useState<McpTool[]>(SEEDED_TOOLS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const fetchTools = async () => {
    setIsLoading(true);
    try {
      const res = await api<{ tools?: McpTool[] }>('GET', '/api/mcp/tools');
      if (res.ok && 'data' in res && res.data?.tools) setTools(res.data.tools);
    } catch { /* keep seeded */ } finally { setIsLoading(false); }
  };

  const testTool = async (name: string) => {
    setTesting((prev) => new Set(prev).add(name));
    try {
      const res = await api('POST', '/api/mcp/call', { body: { tool: name, params: {} } });
      setTestResults((prev) => ({ ...prev, [name]: res.ok ? '✅ OK' : '⚠️ No response' }));
    } catch {
      setTestResults((prev) => ({ ...prev, [name]: '❌ Failed' }));
    } finally {
      setTesting((prev) => { const s = new Set(prev); s.delete(name); return s; });
    }
  };

  const categories = [...new Set(tools.map((t) => t.category))];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-950/60 text-violet-600">
              <Puzzle className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">MCP Inspector</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            MCP server tools — inspect, test, and manage.
          </p>
        </div>
        <button onClick={fetchTools} disabled={isLoading} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-sm text-slate-600 dark:text-slate-400">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /><span>Refresh</span>
        </button>
      </div>

      {categories.map((cat) => (
        <div key={cat} className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{cat}</h3>
          {tools.filter((t) => t.category === cat).map((tool) => (
            <div key={tool.name} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <button onClick={() => setExpanded(expanded === tool.name ? null : tool.name)} className="w-full flex items-center gap-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                {tool.enabled ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <XCircle className="w-4 h-4 text-slate-400 shrink-0" />}
                <span className="font-mono text-sm text-slate-900 dark:text-white flex-1 text-left">{tool.name}</span>
                <span className="text-xs text-slate-400">{tool.description.slice(0, 40)}...</span>
                {expanded === tool.name ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              {expanded === tool.name && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  <p className="text-xs text-slate-500 pt-3">{tool.description}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => testTool(tool.name)} disabled={testing.has(tool.name)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-60">
                      <Play className="w-3.5 h-3.5" /><span>{testing.has(tool.name) ? 'Testing...' : 'Test Call'}</span>
                    </button>
                    {testResults[tool.name] && <span className="text-xs">{testResults[tool.name]}</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
