// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Search, Bell, LogOut } from 'lucide-react';
import { BackendStatus } from './backend-status';
import { api } from '@/lib/api';

export function Header() {
  const [isDark, setIsDark] = useState(false);
  const [authState, setAuthState] = useState<{
    loaded: boolean;
    hasBearer: boolean;
    hasSession: boolean;
  }>({
    loaded: false,
    hasBearer: false,
    hasSession: false,
  });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const isDarkStored =
      localStorage.getItem('theme') === 'dark' ||
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setIsDark(isDarkStored);
    if (isDarkStored) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function checkAuthSession() {
      try {
        const res = await api<{ hasBearer: boolean; hasSession: boolean }>('GET', '/session');
        if (isMounted) {
          if (res.ok && res.data) {
            setAuthState({
              loaded: true,
              hasBearer: Boolean(res.data.hasBearer),
              hasSession: Boolean(res.data.hasSession),
            });
          } else {
            setAuthState({
              loaded: true,
              hasBearer: false,
              hasSession: false,
            });
          }
        }
      } catch {
        if (isMounted) {
          setAuthState({
            loaded: true,
            hasBearer: false,
            hasSession: false,
          });
        }
      }
    }

    checkAuthSession();
    return () => {
      isMounted = false;
    };
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const res = await api('DELETE', '/session');
      if (res.ok) {
        setAuthState({
          loaded: true,
          hasBearer: false,
          hasSession: false,
        });
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    } catch {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  const isConnected = authState.hasBearer || authState.hasSession;

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
      {/* Command palette trigger */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('xa:open-palette'))}
        aria-label="Open command palette (Cmd+K)"
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 w-72 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-500 dark:hover:text-slate-300 transition-colors cursor-pointer"
      >
        <Search className="w-4 h-4" />
        <span className="text-xs">Search features...</span>
        <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-mono">⌘K</kbd>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-3">
        <BackendStatus />

        {/* Auth State Badge & Action */}
        {authState.loaded && (
          <div className="flex items-center gap-2" data-testid="auth-status-container">
            {isConnected ? (
              <>
                <div
                  data-testid="auth-badge-connected"
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Connected</span>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  aria-label="Logout"
                  data-testid="logout-button"
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
                </button>
              </>
            ) : (
              <>
                <div
                  data-testid="auth-badge-disconnected"
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  <span>Disconnected</span>
                </div>
                <a
                  href="/login"
                  data-testid="login-link"
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 border border-blue-200 dark:border-blue-800 transition-colors"
                >
                  Sign in
                </a>
              </>
            )}
          </div>
        )}

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
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
