'use client';

import React, { useEffect, useState } from 'react';
import { Settings, Moon, Sun, Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { keys: '⌘K / Ctrl+K', desc: 'Open command palette' },
  { keys: '↑ ↓', desc: 'Navigate palette results' },
  { keys: '↵', desc: 'Open highlighted result' },
  { keys: 'Esc', desc: 'Close palette / dialogs' },
];

export default function SettingsPage() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch {}
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <Settings className="w-5 h-5" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
      </div>

      <section className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />} Appearance
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-900 dark:text-white">Theme</p>
            <p className="text-xs text-slate-500">Toggle light / dark mode.</p>
          </div>
          <button
            onClick={toggleTheme}
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {isDark ? 'Dark' : 'Light'}
          </button>
        </div>
      </section>

      <section className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
          <Keyboard className="w-4 h-4" /> Keyboard Shortcuts
        </h2>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-slate-600 dark:text-slate-400">{s.desc}</span>
              <kbd className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
