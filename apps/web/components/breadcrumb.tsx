'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { groupForPath, itemForPath } from '@/lib/nav';

/**
 * Group-context breadcrumb — renders `Group ▸ Page` under each page so a
 * deep-linked or palette-navigated user always knows where they landed.
 * Hidden on the Overview route.
 */
export function Breadcrumb() {
  const pathname = usePathname();
  if (!pathname || pathname === '/') return null;
  const group = groupForPath(pathname);
  const item = itemForPath(pathname);
  if (!group || !item) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <li>
          <Link href="/" className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            {group.label}
          </Link>
        </li>
        <li aria-hidden="true"><ChevronRight className="w-3 h-3" /></li>
        <li aria-current="page" className="text-slate-600 dark:text-slate-300 font-medium">
          {item.label}
        </li>
      </ol>
    </nav>
  );
}
