// by nichxbt
'use client';

import React, { useState } from 'react';
import { Gamepad2, Send, Copy, Check, Trash2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Generation {
  id: string;
  prompt: string;
  model: string;
  output: string;
  tokens: number;
  duration: number;
  timestamp: string;
}

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4.5', 'gpt-4o', 'llama-3.3-70b'];

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-haiku-4.5');
  const [maxTokens, setMaxTokens] = useState(500);
  const [temperature, setTemperature] = useState(0.7);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    const start = Date.now();
    try {
      const res = await api<{ text?: string; output?: string; tokens?: number }>(
        'POST', '/api/ai/generate',
        { body: { prompt: prompt.trim(), model, maxTokens, temperature } }
      );
      const output = res.ok && 'data' in res
        ? (res.data?.text || res.data?.output || 'No output')
        : `Generation failed — ${('error' in res && (res.error as {message?:string})?.message) || 'backend offline'}`;
      const gen: Generation = {
        id: `g${Date.now()}`,
        prompt: prompt.trim(),
        model,
        output,
        tokens: res.ok && 'data' in res ? (res.data?.tokens || 0) : 0,
        duration: (Date.now() - start) / 1000,
        timestamp: new Date().toLocaleTimeString(),
      };
      setGenerations((prev) => [gen, ...prev]);
    } catch {
      setGenerations((prev) => [{
        id: `g${Date.now()}`, prompt: prompt.trim(), model,
        output: 'Error: Could not reach backend', tokens: 0,
        duration: (Date.now() - start) / 1000, timestamp: new Date().toLocaleTimeString(),
      }, ...prev]);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyOutput = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-pink-100 dark:bg-pink-950/60 text-pink-600">
            <Gamepad2 className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">AI Playground</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Test prompts, compare models, iterate on generation quality.
        </p>
      </div>

      {/* Input Panel */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt..."
          rows={4}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none"
        />
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full px-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Max Tokens: {maxTokens}</label>
            <input type="range" min={50} max={4000} step={50} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} className="w-full accent-pink-500" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Temperature: {temperature}</label>
            <input type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-pink-500" />
          </div>
        </div>
        <button
          onClick={generate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-medium text-sm transition-colors disabled:opacity-60"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
        </button>
      </div>

      {/* Generations */}
      {generations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Generations ({generations.length})</h2>
            <button onClick={() => setGenerations([])} className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" /><span>Clear</span>
            </button>
          </div>
          {generations.map((gen) => (
            <div key={gen.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-pink-600 dark:text-pink-400">{gen.model}</span>
                  <span>·</span><span>{gen.tokens} tokens</span>
                  <span>·</span><span>{gen.duration.toFixed(2)}s</span>
                  <span>·</span><span>{gen.timestamp}</span>
                </div>
                <button onClick={() => copyOutput(gen.id, gen.output)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                  {copied === gen.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 dark:border-slate-700 pl-3">{gen.prompt}</p>
                <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{gen.output}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
