'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { NAV_GROUPS, groupForPath, type NavGroup, type NavItem } from '@/lib/nav';

const LS_COLLAPSED = 'xa.sidebar.collapsed';
const LS_OPEN = 'xa.sidebar.openGroups';

const BADGE_STYLES: Record<string, string> = {
  Live: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400',
  AI: 'bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400',
  Ops: 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400',
};

function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  // Hydrate persisted state after mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    setCollapsed(readJSON<boolean>(LS_COLLAPSED, false));
    setOpen(readJSON<Record<string, boolean>>(LS_OPEN, {}));
    setMounted(true);
  }, []);

  // Auto-open the group that owns the active route.
  useEffect(() => {
    const g = groupForPath(pathname);
    if (g && g.items.length) {
      setOpen((prev) => (prev[g.id] ? prev : { ...prev, [g.id]: true }));
    }
  }, [pathname]);

  const persist = (key: string, val: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  };

  const toggleGroup = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      persist(LS_OPEN, next);
      return next;
    });
  };

  const toggleCollapse = () => {
    setCollapsed((c) => {
      persist(LS_COLLAPSED, !c);
      return !c;
    });
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href.replace(/\/+$/, ''));

  const itemCls = (active: boolean) =>
    `flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors group relative ${
      active
        ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-200'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
    } ${collapsed ? 'justify-center' : ''}`;

  const ItemLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const inner = (
      <>
        {active && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-blue-600 dark:bg-blue-400" />
        )}
        <span className="flex-1 truncate">{collapsed ? item.label.slice(0, 1) : item.label}</span>
        {!collapsed && item.badge && (
          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${BADGE_STYLES[item.badge]}`}>
            {item.badge}
          </span>
        )}
      </>
    );
    const cls = itemCls(active);
    const aria = { 'aria-current': active ? ('page' as const) : undefined };
    return item.external ? (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} {...aria}>
        {inner}
      </a>
    ) : (
      <Link href={item.href} className={cls} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} {...aria}>
        {inner}
      </Link>
    );
  };

  const GroupBlock = ({ group }: { group: NavGroup }) => {
    const Icon = group.icon;
    // Single-link group (Overview)
    if (group.href) {
      const active = isActive(group.href);
      return (
        <Link
          href={group.href}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? group.label : undefined}
          aria-label={collapsed ? group.label : undefined}
          className={itemCls(active)}
        >
          <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`} />
          {!collapsed && <span className="flex-1">{group.label}</span>}
        </Link>
      );
    }

    const isOpen = open[group.id] ?? (mounted ? !group.defaultCollapsed : !group.defaultCollapsed);
    const hasActive = group.items.some((it) => isActive(it.href));
    const panelId = `nav-panel-${group.id}`;

    // Collapsed rail: top-level icon only, aria-label + tooltip, NO flyout.
    if (collapsed) {
      return (
        <div className="relative">
          <button
            type="button"
            aria-label={group.label}
            title={group.label}
            onClick={toggleCollapse}
            className={`flex items-center justify-center w-full px-3 py-1.5 rounded-md ${
              hasActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Icon className="w-5 h-5" />
          </button>
        </div>
      );
    }

    return (
      <div>
        <button
          type="button"
          onClick={() => toggleGroup(group.id)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex items-center justify-between w-full px-3 py-1.5 rounded-md text-[11px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Icon className="w-4 h-4" />
            <span>{group.label}</span>
            {group.badge && !isOpen && (
              <span className={`w-1.5 h-1.5 rounded-full ${
                group.badge === 'Live' ? 'bg-emerald-500' : group.badge === 'AI' ? 'bg-violet-500' : 'bg-amber-500'
              }`} aria-hidden="true" />
            )}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} aria-hidden="true" />
        </button>
        {isOpen && (
          <ul id={panelId} className="mt-0.5 space-y-0.5">
            {group.items.map((it) => (
              <li key={it.href}>
                <ItemLink item={it} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`relative flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-slate-200 dark:border-slate-800">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">X</div>
            <div>
              <span className="font-bold text-slate-900 dark:text-white tracking-tight">XActions</span>
              <span className="ml-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-semibold">v3.5</span>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 mx-auto rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg">X</div>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label="Primary" className="flex-1 p-3 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <React.Fragment key={g.id}>
            {g.id === 'system' && (
              <div className="pt-1 border-t border-slate-200 dark:border-slate-800" aria-hidden="true" />
            )}
            <GroupBlock group={g} />
          </React.Fragment>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={toggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center w-full py-2 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
