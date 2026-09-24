'use client';

import React, { useState } from 'react';
import {
  Terminal,
  Play,
  RotateCw,
  Copy,
  Check,
  Trash2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

interface PresetCommand {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST';
  defaultBody?: Record<string, unknown>;
}

const PRESET_COMMANDS: PresetCommand[] = [
  {
    id: 'unfollow-non-followers',
    name: 'Unfollow Non-Followers',
    description: 'Safely sweep and remove accounts that do not follow back',
    endpoint: '/api/operations/unfollow-non-followers',
    method: 'POST',
    defaultBody: { maxUnfollows: 50, dryRun: true },
  },
  {
    id: 'detect-unfollowers',
    name: 'Detect Unfollowers',
    description: 'Compare snapshot diffs to find users who recently unfollowed',
    endpoint: '/api/operations/detect-unfollowers',
    method: 'POST',
    defaultBody: {},
  },
  {
    id: 'probe-canaries',
    name: 'Scraper Canary Health Probe',
    description: 'Run background reliability probes across all scraper adapters',
    endpoint: '/api/benchmark/probe-all',
    method: 'POST',
    defaultBody: {},
  },
  {
    id: 'fetch-health',
    name: 'System Diagnostics & Health',
    description: 'Inspect upstream service status, memory, and hibernation',
    endpoint: '/api/health',
    method: 'GET',
  },
  {
    id: 'list-operations',
    name: 'List Recent Operations',
    description: 'Fetch historical automation executions and queue state',
    endpoint: '/api/operations',
    method: 'GET',
  },
];

export default function RunPage() {
  const [selectedPreset, setSelectedPreset] = useState<PresetCommand>(PRESET_COMMANDS[0]);
  const [commandText, setCommandText] = useState(
    'POST /api/operations/unfollow-non-followers {"maxUnfollows":50,"dryRun":true}'
  );
  const [customBody, setCustomBody] = useState(
    JSON.stringify(PRESET_COMMANDS[0].defaultBody || {}, null, 2)
  );
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [logs, setLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] READY — Select a preset or type a command to execute`,
  ]);
  const [copied, setCopied] = useState(false);

  const appendLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${msg}`]);
  };

  const handleSelectPreset = (preset: PresetCommand) => {
    setSelectedPreset(preset);
    const bodyStr = JSON.stringify(preset.defaultBody || {}, null, 2);
    setCustomBody(bodyStr);
    setCommandText(
      preset.method === 'GET'
        ? `GET ${preset.endpoint}`
        : `POST ${preset.endpoint} ${JSON.stringify(preset.defaultBody || {})}`
    );
  };

  const handleExecute = async () => {
    setIsRunning(true);
    setStatus('running');
    appendLog(`EXECUTE -> ${selectedPreset.method} ${selectedPreset.endpoint}`);

    try {
      let parsedBody: unknown = undefined;
      if (selectedPreset.method === 'POST') {
        try {
          parsedBody = customBody.trim() ? JSON.parse(customBody) : {};
        } catch {
          appendLog(`ERROR: Invalid JSON in request body`);
          setStatus('failed');
          setIsRunning(false);
          return;
        }
      }

      appendLog(`Dispatching through BFF proxy...`);
      const res = await api(selectedPreset.method, selectedPreset.endpoint, {
        body: parsedBody,
      });

      if (res.ok) {
        setStatus('completed');
        appendLog(`SUCCESS (HTTP ${res.status}):`);
        appendLog(JSON.stringify(res.data, null, 2));
      } else {
        setStatus('failed');
        appendLog(`FAILED (HTTP ${res.status}):`);
        appendLog(JSON.stringify(res.error, null, 2));
      }
    } catch (err) {
      setStatus('failed');
      appendLog(`EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyLogs = () => {
    navigator.clipboard?.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearLogs = () => {
    setLogs([`[${new Date().toLocaleTimeString()}] Console logs cleared`]);
    setStatus('idle');
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Terminal className="w-7 h-7 text-indigo-500" />
            Command Runner
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Trigger automation scripts, execute canary probes, and monitor live output streams
          </p>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${
              status === 'completed'
                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                : status === 'failed'
                ? 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400'
                : status === 'running'
                ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            {status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
            {status === 'failed' && <AlertCircle className="w-3.5 h-3.5" />}
            {status === 'running' && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
            {status === 'idle' && <Clock className="w-3.5 h-3.5" />}
            <span>{status}</span>
          </span>
        </div>
      </div>

      {/* Preset Command Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          Preset Automation Commands
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PRESET_COMMANDS.map((preset) => {
            const isSelected = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className={`p-4 rounded-xl text-left border transition-all ${
                  isSelected
                    ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-500 ring-1 ring-blue-500 shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-slate-900 dark:text-white">
                    {preset.name}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      preset.method === 'POST'
                        ? 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {preset.method}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Command Dispatcher Box */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              Target Endpoint &amp; Parameters
            </span>
          </div>

          <button
            onClick={handleExecute}
            disabled={isRunning}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all disabled:opacity-50"
          >
            {isRunning ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            <span>Execute Command</span>
          </button>
        </div>

        {/* Command string preview */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
            Command String
          </label>
          <input
            type="text"
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            className="w-full px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="POST /api/operations/..."
          />
        </div>

        {/* JSON Body editor for POST */}
        {selectedPreset.method === 'POST' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Payload Body (JSON)
            </label>
            <textarea
              rows={3}
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
              placeholder="{}"
            />
          </div>
        )}
      </div>

      {/* Terminal Output Log Area */}
      <div className="rounded-2xl bg-slate-950 border border-slate-800 shadow-lg overflow-hidden flex flex-col">
        {/* Terminal Header */}
        <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-xs font-mono text-slate-400 ml-2">Console Output</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyLogs}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 transition-colors"
              title="Copy output"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleClearLogs}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Clear log"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div className="p-4 font-mono text-xs text-slate-200 min-h-[300px] max-h-[460px] overflow-y-auto space-y-1.5">
          {logs.map((log, index) => {
            const isError = log.includes('ERROR') || log.includes('FAILED') || log.includes('EXCEPTION');
            const isSuccess = log.includes('SUCCESS');
            const isExecute = log.includes('EXECUTE');

            return (
              <div
                key={index}
                className={`break-words whitespace-pre-wrap leading-relaxed ${
                  isError
                    ? 'text-rose-400'
                    : isSuccess
                    ? 'text-emerald-400'
                    : isExecute
                    ? 'text-blue-400 font-semibold'
                    : 'text-slate-300'
                }`}
              >
                {log}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
