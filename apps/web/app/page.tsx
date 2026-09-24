import React from 'react';
import { Flame, Users, Sparkles, Database, ArrowUpRight, ShieldCheck, Zap, ShieldAlert } from 'lucide-react';

export default function DashboardOverview() {
  const cards = [
    {
      title: 'Viral DNA Miner',
      description: 'Analyze millions of viral posts across 18 social platforms with JevBrain AI classification.',
      icon: Flame,
      color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/40',
      href: '/viral-miner',
      stats: '18 Platforms Supported',
    },
    {
      title: 'Follower CRM',
      description: 'Segment and qualify leads, calculate Lead Scores, and tag high-value followers automatically.',
      icon: Users,
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/40',
      href: '/crm',
      stats: 'Zero API Fee',
    },
    {
      title: 'Content Optimizer',
      description: 'Predict viral coefficient score, optimize hashtags, and generate high-converting variations.',
      icon: Sparkles,
      color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800/40',
      href: '/optimizer',
      stats: 'AI Powered',
    },
    {
      title: 'Universal Explorer',
      description: 'Query cross-industry datasets: recruitment, real estate, company registry, and social signals.',
      icon: Database,
      color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/40',
      href: '/explorer',
      stats: '25 Crawlers Active',
    },
    {
      title: 'System Admin Control Plane',
      description: 'Manage crawler checkpoints, proxy pool quarantine, stream metrics, and x402 payment settlements.',
      icon: ShieldAlert,
      color: 'text-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/40',
      href: '/admin',
      stats: 'Ops Control',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Hero Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/10">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-white/20 uppercase tracking-wider">
              XActions v3.5
            </span>
            <span className="text-xs text-blue-100 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" /> High Performance
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Social Intelligence & Automation Hub</h1>
          <p className="text-sm text-blue-100 max-w-xl">
            Browser automation, viral pattern mining, and unified contract-driven APIs for autonomous agents and marketers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/api-docs/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
          >
            <span>Swagger API Docs</span>
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Feature Navigation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <a
              key={card.title}
              href={card.href}
              className="flex flex-col justify-between p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all group"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className={`p-3 rounded-xl border ${card.color}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    {card.stats}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                <span>Open module</span>
                <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </div>
            </a>
          );
        })}
      </div>

      {/* Architecture & Reliability Badge */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Universal Contract Architecture: Type-safe, Zero-drift, Zod & OpenAPI 3.1 Synchronized</span>
        </div>
        <span className="font-mono text-[11px] text-slate-400">Next.js 15 App Router</span>
      </div>
    </div>
  );
}
