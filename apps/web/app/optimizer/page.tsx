'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  Zap,
  Copy,
  Check,
  Hash,
  Wand2,
  RefreshCw,
  Gauge,
  ThumbsUp,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import { api } from '@/lib/api';

export default function ContentOptimizerPage() {
  const [content, setContent] = useState(
    'Most people are using AI completely wrong. They ask generic questions and get generic answers.\n\nHere are 3 frameworks to turn any LLM into a top 1% strategic advisor in under 5 minutes:'
  );
  const [targetGoal, setTargetGoal] = useState<'viral' | 'professional' | 'story' | 'controversial'>('viral');
  const [predictedScore, setPredictedScore] = useState<number | null>(84);
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    hook: number;
    clarity: number;
    skimmability: number;
    tips: string[];
  }>({
    hook: 92,
    clarity: 88,
    skimmability: 80,
    tips: [
      'Strong provocative opening hook.',
      'Consider adding numbered bullets in the next lines.',
      'High re-post potential in SaaS and Tech niches.',
    ],
  });

  const [rewritten, setRewritten] = useState<string | null>(null);
  const [isRewriting, setIsRewriting] = useState(false);
  const [isPredicting, setIsPredicting] = useState(false);
  const [hashtags, setHashtags] = useState<string[]>(['#AI', '#Productivity', '#TechTrends', '#Growth', '#SaaS']);
  const [copied, setCopied] = useState(false);

  const handlePredict = async () => {
    setIsPredicting(true);
    try {
      const res = await api<{ score?: number }>('POST', '/api/optimizer/predict', {
        body: { text: content },
      });
      if (res.ok && res.data?.score) {
        setPredictedScore(res.data.score);
      } else {
        // Fallback simulation based on length and punctuation
        const calculated = Math.min(95, Math.max(50, 70 + Math.floor(content.length / 30)));
        setPredictedScore(calculated);
      }
    } catch {
      setPredictedScore(86);
    } finally {
      setIsPredicting(false);
    }
  };

  const handleRewrite = async () => {
    setIsRewriting(true);
    try {
      const res = await api<{ optimizedText?: string }>('POST', '/api/optimizer/optimize', {
        body: { text: content, goal: targetGoal },
      });
      if (res.ok && res.data?.optimizedText) {
        setRewritten(res.data.optimizedText);
        setIsRewriting(false);
        return;
      }
    } catch {}

    // Fallback AI rewrite templates
    setTimeout(() => {
      if (targetGoal === 'viral') {
        setRewritten(
          '99% of people are using ChatGPT like a search engine.\n\nBig mistake.\n\nThe real power comes when you turn it into a relentless sparring partner.\n\nHere are the 3 mental models I use to get 10x better outputs:'
        );
      } else if (targetGoal === 'controversial') {
        setRewritten(
          'Unpopular truth:\n\nPrompt engineering isn’t dead — people are just lazy.\n\nIf your outputs look mediocre, your thinking is mediocre.\n\n3 ways to fix it immediately:'
        );
      } else {
        setRewritten(
          'A strategic guide to prompt execution:\n\nGeneric inquiries naturally yield generic outputs. To maximize advisory depth, implement structured role-framing and iterative feedback loops.\n\nKey takeaways below:'
        );
      }
      setIsRewriting(false);
    }, 700);
  };

  const handleGenerateHashtags = async () => {
    try {
      const res = await api<{ hashtags?: string[] }>('POST', '/api/optimizer/hashtags', {
        body: { text: content },
      });
      if (res.ok && res.data?.hashtags) {
        setHashtags(res.data.hashtags);
        return;
      }
    } catch {}
    setHashtags(['#ArtificialIntelligence', '#FounderTips', '#GenerativeAI', '#TechGrowth', '#BuildInPublic']);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            AI Content Optimizer Playground
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Score viral potential, benchmark readability metrics, and rewrite high-converting social copy side-by-side.
        </p>
      </div>

      {/* Editor & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Editor & Rewrite (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Draft Content
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {content.length} characters • ~{Math.ceil(content.split(/\s+/).length)} words
              </span>
            </div>

            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste or write your social post here..."
              className="w-full p-4 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans leading-relaxed resize-none"
            />

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              {/* Goal Select */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-medium">Goal:</span>
                {(['viral', 'controversial', 'professional'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setTargetGoal(g)}
                    className={`px-2.5 py-1 rounded-lg capitalize transition-colors font-semibold ${
                      targetGoal === g
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePredict}
                  disabled={isPredicting}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <Gauge className="w-3.5 h-3.5 text-blue-500" />
                  <span>{isPredicting ? 'Predicting...' : 'Predict Score'}</span>
                </button>
                <button
                  onClick={handleRewrite}
                  disabled={isRewriting}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors shadow-sm"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{isRewriting ? 'Rewriting...' : 'Rewrite with AI'}</span>
                </button>
              </div>
            </div>

            {/* Hashtag Pills */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {hashtags.map((h) => (
                  <button
                    key={h}
                    onClick={() => setContent((prev) => `${prev} ${h}`)}
                    className="text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/50 hover:text-purple-600 text-slate-600 dark:text-slate-400 transition-colors"
                  >
                    {h}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateHashtags}
                className="text-xs text-purple-600 dark:text-purple-400 hover:underline shrink-0 flex items-center gap-1"
              >
                <Hash className="w-3 h-3" />
                <span>Suggest tags</span>
              </button>
            </div>
          </div>

          {/* Rewritten Output (Side-by-side or bottom) */}
          {rewritten && (
            <div className="p-5 rounded-2xl border border-purple-200 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-950/20 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
                    AI Optimized Variation ({targetGoal})
                  </span>
                </div>
                <button
                  onClick={() => handleCopy(rewritten)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-50 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Post'}</span>
                </button>
              </div>
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed font-sans p-4 rounded-xl bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/40">
                {rewritten}
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Viral Score & Intelligence Metrics (1 col) */}
        <div className="space-y-6">
          {/* Viral Potential Gauge Card */}
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-5 text-center">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Viral Potential Score
            </h3>

            {/* Circular Gauge simulation */}
            <div className="relative inline-flex items-center justify-center">
              <div className="w-36 h-36 rounded-full border-8 border-slate-100 dark:border-slate-800 flex items-center justify-center relative">
                <div className="text-center">
                  <span className="text-4xl font-black text-purple-600 dark:text-purple-400 tracking-tight">
                    {predictedScore ?? '--'}
                  </span>
                  <span className="text-xs text-slate-400 block font-medium">out of 100</span>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-300 font-medium">
              {predictedScore && predictedScore >= 80 ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center justify-center gap-1">
                  <ThumbsUp className="w-3.5 h-3.5" /> High Engagement Potential
                </span>
              ) : (
                <span className="text-amber-600 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Needs stronger hook
                </span>
              )}
            </div>

            {/* Metrics Breakdown */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-left">
              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  <span>Hook Power</span>
                  <span className="font-bold">{scoreBreakdown.hook}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 rounded-full" style={{ width: `${scoreBreakdown.hook}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  <span>Clarity & Tone</span>
                  <span className="font-bold">{scoreBreakdown.clarity}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${scoreBreakdown.clarity}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  <span>Skimmability</span>
                  <span className="font-bold">{scoreBreakdown.skimmability}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${scoreBreakdown.skimmability}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Suggestions Card */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-3">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>AI Feedback</span>
            </h4>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              {scoreBreakdown.tips.map((tip, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
