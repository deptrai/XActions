// by nichxbt
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, Wifi, WifiOff, RefreshCw, Bot } from 'lucide-react';
import { api } from '@/lib/api';

interface A2AMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  type: 'request' | 'response' | 'event';
}

interface Agent {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  capabilities: string[];
}

const SEEDED_AGENTS: Agent[] = [
  { id: 'a1', name: 'scraper-agent-01', status: 'online', capabilities: ['scrape', 'extract'] },
  { id: 'a2', name: 'analyzer-agent-02', status: 'online', capabilities: ['analyze', 'classify'] },
  { id: 'a3', name: 'poster-agent-03', status: 'busy', capabilities: ['post', 'schedule'] },
  { id: 'a4', name: 'monitor-agent-04', status: 'offline', capabilities: ['monitor', 'alert'] },
];

const SEEDED_MESSAGES: A2AMessage[] = [
  { id: 'm1', from: 'orchestrator', to: 'scraper-agent-01', content: 'scrape trending topics for niche=ai', timestamp: '10:23:41', type: 'request' },
  { id: 'm2', from: 'scraper-agent-01', to: 'orchestrator', content: 'completed: 47 topics extracted', timestamp: '10:23:58', type: 'response' },
  { id: 'm3', from: 'orchestrator', to: 'analyzer-agent-02', content: 'classify topics by engagement_score', timestamp: '10:24:02', type: 'request' },
  { id: 'm4', from: 'analyzer-agent-02', to: 'orchestrator', content: 'classified: 12 high, 23 medium, 12 low', timestamp: '10:24:19', type: 'response' },
];

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-emerald-500',
  offline: 'bg-slate-400',
  busy: 'bg-amber-500',
};

const TYPE_COLORS: Record<string, string> = {
  request: 'text-blue-600 dark:text-blue-400',
  response: 'text-emerald-600 dark:text-emerald-400',
  event: 'text-purple-600 dark:text-purple-400',
};

export default function A2APage() {
  const [agents, setAgents] = useState<Agent[]>(SEEDED_AGENTS);
  const [messages, setMessages] = useState<A2AMessage[]>(SEEDED_MESSAGES);
  const [input, setInput] = useState('');
  const [target, setTarget] = useState('a1');
  const [connected, setConnected] = useState(false);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Try SSE connection via BFF
    try {
      const es = new EventSource('/api/a2a/stream');
      eventSourceRef.current = es;
      es.onopen = () => { setConnected(true); setSseStatus('connected'); };
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as A2AMessage;
          setMessages((prev) => [...prev, msg]);
        } catch {}
      };
      es.onerror = () => { setConnected(false); setSseStatus('error'); es.close(); };
    } catch {
      setSseStatus('error');
    }
    return () => { eventSourceRef.current?.close(); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg: A2AMessage = {
      id: `m${Date.now()}`,
      from: 'orchestrator',
      to: agents.find((a) => a.id === target)?.name || target,
      content: input.trim(),
      timestamp: new Date().toLocaleTimeString(),
      type: 'request',
    };
    setMessages((prev) => [...prev, msg]);
    setInput('');
    await api('POST', '/api/a2a/send', { body: msg }).catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-950/60 text-violet-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">A2A Console</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Agent-to-Agent protocol monitor — live message stream.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
            sseStatus === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
            : sseStatus === 'connecting' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'
          }`}>
            {sseStatus === 'connected' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span>{sseStatus === 'connected' ? 'SSE Connected' : sseStatus === 'connecting' ? 'Connecting...' : 'SSE Offline (polling)'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Agent List */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Agents</h3>
          {agents.map((agent) => (
            <div key={agent.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[agent.status]}`} />
                <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">{agent.name}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {agent.capabilities.map((c) => (
                  <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Message Stream */}
        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Message Stream</span>
              <span className="text-xs text-slate-400">{messages.length} messages</span>
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-2 font-mono text-xs">
              {messages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-2">
                  <span className="text-slate-400 shrink-0">{msg.timestamp}</span>
                  <span className={`shrink-0 font-semibold ${TYPE_COLORS[msg.type]}`}>
                    {msg.type === 'request' ? '→' : msg.type === 'response' ? '←' : '⚡'}
                  </span>
                  <span className="text-slate-500 shrink-0">{msg.from} → {msg.to}:</span>
                  <span className="text-slate-700 dark:text-slate-300 break-all">{msg.content}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Send Message */}
          <div className="flex gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Send message to agent..."
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
