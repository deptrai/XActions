'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Search, Bell } from 'lucide-react';
import { BackendStatus } from './backend-status';

export function Header() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isDarkStored = localStorage.getItem('theme') === 'dark' ||
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setIsDark(isDarkStored);
    if (isDarkStored) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
      {/* Global Search Mock */}
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 w-72">
        <Search className="w-4 h-4" />
        <span className="text-xs">Quick search (cmd+k)...</span>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        <BackendStatus />

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>

        {/* Notifications */}
        <button
          aria-label="Notifications"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
