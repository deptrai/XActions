'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, CornerDownLeft } from 'lucide-react';
import { NAV_INDEX, NAV_ACTIONS, type NavIndexEntry } from '@/lib/nav';

const LS_RECENT = 'xa.palette.recent';

interface Entry {
  label: string;
  href: string;
  groupLabel: string;
  keywords: string[];
  badge?: string;
  external?: boolean;
  isAction?: boolean;
}

const ALL: Entry[] = [
  ...NAV_INDEX.map((e) => ({ ...e })),
  ...NAV_ACTIONS.map((a) => ({ ...a, isAction: true })),
];

function fuzzy(entry: Entry, q: string): boolean {
  const hay = `${entry.label} ${entry.groupLabel} ${entry.keywords.join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((tok) => hay.includes(tok));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_RECENT);
      if (v) setRecent(JSON.parse(v));
    } catch {}
  }, []);

  const openPalette = useCallback(() => {
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);

  // Global ⌘K / Ctrl+K listener + custom event from header button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => openPalette();
    window.addEventListener('keydown', onKey);
    window.addEventListener('xa:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('xa:open-palette', onOpen);
    };
  }, [openPalette]);

  // Autofocus input when opened; remember + restore the previously-focused
  // element on close, and lock body scroll while the palette is up (a11y).
  const prevFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
    document.body.style.overflow = '';
    prevFocusRef.current?.focus();
  }, [open]);

  const results = useMemo<Entry[]>(() => {
    if (!query.trim()) {
      // No query → recent surfaces first, then a sensible default set.
      const recentEntries = recent
        .map((h) => ALL.find((e) => e.href === h))
        .filter((e): e is Entry => Boolean(e));
      const defaults = ALL.filter((e) => !e.isAction).slice(0, 8);
      const seen = new Set(recentEntries.map((e) => e.href));
      return [...recentEntries, ...defaults.filter((e) => !seen.has(e.href))].slice(0, 9);
    }
    return ALL.filter((e) => fuzzy(e, query)).slice(0, 9);
  }, [query, recent]);

  useEffect(() => { setActive(0); }, [query]);

  const pick = useCallback((e: Entry) => {
    setOpen(false);
    // record recent
    setRecent((prev) => {
      const next = [e.href, ...prev.filter((h) => h !== e.href)].slice(0, 5);
      try { localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch {}
      return next;
    });
    if (e.external) {
      window.open(e.href, '_blank', 'noopener,noreferrer');
    } else {
      router.push(e.href);
    }
  }, [router]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) pick(r); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  // Keep active item scrolled into view.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const activeId = `pal-opt-${active}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-slate-900/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search features…"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-listbox"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            className="flex-1 py-3 bg-transparent text-sm outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">ESC</kbd>
        </div>

        {results.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            No results for “{query}”
          </div>
        ) : (
          <ul ref={listRef} id="pal-listbox" role="listbox" aria-label="Results" className="py-2 max-h-[50vh] overflow-y-auto text-sm">
            {results.map((r, i) => (
              <li
                key={r.href + r.label}
                id={`pal-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={`px-4 py-2 flex items-center justify-between cursor-pointer ${
                  i === active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="flex items-center gap-2">
                  {r.isAction && <span className={`text-[10px] font-bold ${i===active?'text-blue-200':'text-amber-500'}`}>⚡</span>}
                  <span>{r.label}</span>
                </span>
                <span className={`text-xs flex items-center gap-2 ${i === active ? 'text-blue-100' : 'text-slate-400'}`}>
                  {r.groupLabel}
                  {i === active && <CornerDownLeft className="w-3 h-3" />}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 flex items-center gap-4">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          <span className="ml-auto" role="status" aria-live="polite">{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
