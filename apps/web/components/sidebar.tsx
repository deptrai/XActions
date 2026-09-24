'use client';

import React, { useState } from 'react';
import Link from 'next/navigation';
import {
  LayoutDashboard,
  Flame,
  Users,
  Sparkles,
  Database,
  FileCode2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bot,
} from 'lucide-react';

const navItems = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Viral DNA Miner', href: '/viral-miner', icon: Flame, badge: 'AI' },
  { label: 'Follower CRM', href: '/crm', icon: Users },
  { label: 'Content Optimizer', href: '/optimizer', icon: Sparkles },
  { label: 'Universal Explorer', href: '/explorer', icon: Database },
  { label: 'Agent Persona', href: '/agent', icon: Bot },
  { label: 'Swagger API Docs', href: 'http://localhost:3001/api-docs/', icon: FileCode2, external: true },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`relative flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-slate-200 dark:border-slate-800">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              X
            </div>
            <div>
              <span className="font-bold text-slate-900 dark:text-white tracking-tight">XActions</span>
              <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-semibold">
                v3.5
              </span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 mx-auto rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
            X
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href={item.href}
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noopener noreferrer' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white ${
                collapsed ? 'justify-center' : ''
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 shrink-0 text-slate-500 group-hover:text-blue-500" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.badge && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full py-2 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
