// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
'use client';

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Optional client-side auth guard wrapper for SPA screens.
 * Checks /session state and shows fallback/redirects to /login if unauthenticated.
 */
export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function checkAuth() {
      try {
        const res = await api<{ hasBearer: boolean; hasSession: boolean }>('GET', '/session');
        if (isMounted) {
          const authed = Boolean(res.ok && res.data && (res.data.hasBearer || res.data.hasSession));
          setIsAuthenticated(authed);
          if (!authed && typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
      } catch {
        if (isMounted) {
          setIsAuthenticated(false);
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
      }
    }

    checkAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isAuthenticated === null) {
    return fallback ?? (
      <div className="flex items-center justify-center p-12 text-sm text-slate-400">
        Verifying session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
