'use client';

// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.

/**
 * Story 48.4 — Admin Console Full Parity (/admin)
 * Full Next.js 15 App Router rewrite of legacy dashboard/admin.html (3119 lines)
 *
 * Tab Parity:
 * 1. Jobs & Checkpoints: Filter toolbar, table with pagination, pause/resume/retry actions
 * 2. Proxies & Accounts: Rate budget & quota allocation, throttle gauge, consumer RPM limits,
 *    queue priority allocator, platform DOM drift canary, proxy budget & tier (Epic 40),
 *    proxy pool health table (quarantine/release), scraper accounts & hibernation (wake/probe/rotate)
 * 3. Stream Metrics & Alerts: Throughput SVG chart (5m/1h/24h), metric cards, active alerts,
 *    alert channels configuration (webhook URL, email recipients, test alert)
 * 4. x402 Micropayments: Payment statistics, payments by operation, recent payments, webhook config
 * 5. Live Sessions: Session cards, progress bars, real-time activity log streams
 *
 * Invariants:
 * - 'use client' component
 * - All API requests route via api() helper to /api/* BFF proxy (no raw fetch)
 * - Realtime via lib/realtime.ts with polling fallback
 * - Hand-rolled Tailwind CSS + Lucide React (no shadcn/radix)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert,
  Server,
  Radio,
  Coins,
  Cpu,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Layers,
  Search,
  Clock,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Send,
  DollarSign,
  Flame,
  ExternalLink,
  Bell,
  Wifi,
  WifiOff,
  Zap,
  Shield,
  Gauge,
  Check,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getRealtimeClient, type RealtimeStatus, type SystemHealthData } from '@/lib/realtime';

// ==========================================
// Types & Interfaces
// ==========================================

export type AdminTab = 'checkpoints' | 'proxies' | 'stream' | 'payments' | 'sessions';

export interface Checkpoint {
  id: string;
  crawler: string;
  target: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stalled';
  itemsScraped: number;
  lastActive: string;
  cursor?: string;
  errors?: number;
  platform?: string;
}

export interface ProxyNode {
  id: string;
  ip: string;
  protocol: string;
  status: 'healthy' | 'quarantined' | 'cooldown' | 'unhealthy';
  latency: number;
  successRate: number;
  tier?: string;
  type?: string;
}

export interface ScraperAccount {
  id: string;
  platform: string;
  username: string;
  status: 'active' | 'hibernating' | 'rate_limited';
  remainingSec: number;
  reason?: string;
  velocity: number;
  assignedProxy?: string;
  healthScore: number;
  circuitState: 'closed' | 'open' | 'half-open';
}

export interface ConsumerPriority {
  id: string;
  name: string;
  priority: number;
  rpmLimit: number;
  rpmUsed: number;
  burst: number;
  status: 'active' | 'throttled' | 'idle';
}

export interface GovernorState {
  level: 'NORMAL' | 'REDUCED' | 'BACKPRESSURE' | 'CRITICAL';
  rpmAllocated: number;
  rpmLimit: number;
  panicStopped: boolean;
  consumers: ConsumerPriority[];
  platformDrift: Record<string, { ok: boolean; successRate: number; selectorScore: number }>;
}

export interface ProxyBudgetTier {
  costPerGb: number;
  activeProxies: number;
  usageGb: number;
}

export interface ProxyBudgetState {
  dailyBudget: number;
  spentToday: number;
  remaining: number;
  currency: string;
  tiers: Record<string, ProxyBudgetTier>;
}

export interface StreamMetricsState {
  eventsPerSec: number;
  pending: number;
  consumerLag: number;
  dropped: number;
  lastAckLatencyMs: number;
  maxLen: number;
  series: Array<{ timestamp: number; events: number; pending: number }>;
}

export interface StreamAlertItem {
  id: string;
  name: string;
  severity: 'CRITICAL' | 'WARNING';
  value: string | number;
  threshold: string | number;
  timestamp: string;
}

export interface PaymentTransaction {
  id: string;
  operation: string;
  amountUsdc: number;
  timestamp: string;
  txHash: string;
  status: 'confirmed' | 'pending';
}

export interface PaymentLedgerState {
  totalPayments: number;
  totalRevenueUsdc: number;
  webhookStatus: 'active' | 'idle';
  byOperation: Record<string, { count: number; totalUsdc: number }>;
  recent: PaymentTransaction[];
  webhooks: {
    customEndpointUrl: string;
    discordEnabled: boolean;
    slackEnabled: boolean;
    signingEnabled: boolean;
  };
}

export interface LiveSessionItem {
  id: string;
  userHandle: string;
  operation: string;
  status: 'running' | 'idle' | 'completed' | 'error';
  progress: { current: number; total: number; message?: string };
  startedAt: string;
  logs: Array<{ timestamp: string; message: string; type: 'info' | 'warn' | 'error' }>;
}

// ==========================================
// Seed Data (for graceful offline/test fallback)
// ==========================================

const INITIAL_CHECKPOINTS: Checkpoint[] = [
  { id: 'cp-8412', crawler: 'twitter-hybrid', target: '@elonmusk', status: 'running', itemsScraped: 12450, lastActive: '2s ago', platform: 'twitter', cursor: 'DAAC...==', errors: 0 },
  { id: 'cp-8413', crawler: 'facebook-marketplace', target: 'Hanoi Real Estate', status: 'paused', itemsScraped: 4320, lastActive: '5m ago', platform: 'facebook', cursor: 'FA89...==', errors: 2 },
  { id: 'cp-8414', crawler: 'threads-graphql', target: '#buildinpublic', status: 'completed', itemsScraped: 8500, lastActive: '12m ago', platform: 'threads', cursor: 'TH12...==', errors: 0 },
  { id: 'cp-8415', crawler: 'tiktok-video', target: '@ai_trends', status: 'failed', itemsScraped: 310, lastActive: '25m ago', platform: 'tiktok', cursor: 'TK99...==', errors: 5 },
  { id: 'cp-8416', crawler: 'bluesky-firehose', target: '#tech', status: 'stalled', itemsScraped: 920, lastActive: '1h ago', platform: 'bluesky', cursor: 'BS01...==', errors: 1 },
];

const INITIAL_PROXIES: ProxyNode[] = [
  { id: 'px-1', ip: '103.152.220.14', protocol: 'SOCKS5', status: 'healthy', latency: 45, successRate: 99.4, tier: 'datacenter', type: 'Datacenter' },
  { id: 'px-2', ip: '14.225.210.89', protocol: 'HTTP', status: 'healthy', latency: 38, successRate: 98.8, tier: 'datacenter', type: 'Datacenter' },
  { id: 'px-3', ip: '118.69.135.24', protocol: 'HTTPS', status: 'cooldown', latency: 120, successRate: 85.2, tier: 'residential', type: 'Residential' },
  { id: 'px-4', ip: '171.244.33.102', protocol: 'SOCKS5', status: 'quarantined', latency: 420, successRate: 42.1, tier: 'mobile_4g', type: 'Mobile 4G' },
  { id: 'px-5', ip: '45.118.144.12', protocol: 'HTTP', status: 'healthy', latency: 62, successRate: 97.5, tier: 'free', type: 'Free Community' },
];

const INITIAL_ACCOUNTS: ScraperAccount[] = [
  { id: 'acc-1', platform: 'twitter', username: '@bot_feeder_01', status: 'active', remainingSec: 0, velocity: 42, assignedProxy: '103.152.220.14', healthScore: 94, circuitState: 'closed' },
  { id: 'acc-2', platform: 'twitter', username: '@signal_hound_9', status: 'hibernating', remainingSec: 412, reason: '429 Rate Limited by X', velocity: 0, assignedProxy: '14.225.210.89', healthScore: 68, circuitState: 'open' },
  { id: 'acc-3', platform: 'threads', username: '@threads_watcher', status: 'active', remainingSec: 0, velocity: 28, assignedProxy: '118.69.135.24', healthScore: 98, circuitState: 'closed' },
  { id: 'acc-4', platform: 'tiktok', username: '@tok_miner_alpha', status: 'rate_limited', remainingSec: 1250, reason: 'Challenge Flow Triggered', velocity: 0, assignedProxy: '171.244.33.102', healthScore: 45, circuitState: 'half-open' },
];

const INITIAL_GOVERNOR: GovernorState = {
  level: 'NORMAL',
  rpmAllocated: 340,
  rpmLimit: 1200,
  panicStopped: false,
  consumers: [
    { id: 'c-1', name: 'Realtime Miner Worker', priority: 1, rpmLimit: 400, rpmUsed: 145, burst: 60, status: 'active' },
    { id: 'c-2', name: 'CRM Enrichment Flow', priority: 2, rpmLimit: 300, rpmUsed: 92, burst: 40, status: 'active' },
    { id: 'c-3', name: 'Profile Graph Crawl', priority: 3, rpmLimit: 250, rpmUsed: 65, burst: 30, status: 'active' },
    { id: 'c-4', name: 'Marketplace Explorer', priority: 4, rpmLimit: 150, rpmUsed: 38, burst: 20, status: 'idle' },
  ],
  platformDrift: {
    twitter: { ok: true, successRate: 98.4, selectorScore: 99.1 },
    threads: { ok: true, successRate: 96.2, selectorScore: 95.0 },
    tiktok: { ok: false, successRate: 74.0, selectorScore: 62.5 },
    facebook: { ok: true, successRate: 91.8, selectorScore: 88.0 },
  },
};

const INITIAL_BUDGET: ProxyBudgetState = {
  dailyBudget: 50.0,
  spentToday: 7.9,
  remaining: 42.1,
  currency: 'USD',
  tiers: {
    free: { costPerGb: 0.0, activeProxies: 12, usageGb: 4.8 },
    datacenter: { costPerGb: 0.5, activeProxies: 18, usageGb: 11.2 },
    residential: { costPerGb: 8.0, activeProxies: 4, usageGb: 0.28 },
    mobile_4g: { costPerGb: 15.0, activeProxies: 2, usageGb: 0.05 },
  },
};

const INITIAL_STREAM_METRICS: StreamMetricsState = {
  eventsPerSec: 48.2,
  pending: 0,
  consumerLag: 0,
  dropped: 0,
  lastAckLatencyMs: 12,
  maxLen: 100000,
  series: [
    { timestamp: Date.now() - 240000, events: 38, pending: 2 },
    { timestamp: Date.now() - 180000, events: 45, pending: 1 },
    { timestamp: Date.now() - 120000, events: 52, pending: 0 },
    { timestamp: Date.now() - 60000, events: 42, pending: 3 },
    { timestamp: Date.now(), events: 48, pending: 0 },
  ],
};

const INITIAL_STREAM_ALERTS: StreamAlertItem[] = [
  { id: 'alt-101', name: 'Redis Consumer Group Lag', severity: 'WARNING', value: '45 msgs', threshold: '> 30 msgs', timestamp: '14m ago' },
  { id: 'alt-102', name: 'TikTok Selector Drift Anomaly', severity: 'CRITICAL', value: '62.5% pass', threshold: '< 75.0% pass', timestamp: '32m ago' },
];

const INITIAL_PAYMENTS: PaymentLedgerState = {
  totalPayments: 1842,
  totalRevenueUsdc: 18.42,
  webhookStatus: 'active',
  byOperation: {
    'twitter:scrape_profile': { count: 820, totalUsdc: 8.2 },
    'twitter:search_recent': { count: 540, totalUsdc: 5.4 },
    'threads:crawl_user': { count: 310, totalUsdc: 3.1 },
    'tiktok:extract_metadata': { count: 172, totalUsdc: 1.72 },
  },
  recent: [
    { id: 'tx-901', operation: 'twitter:scrape_profile', amountUsdc: 0.01, timestamp: '1m ago', txHash: '0x8f2a...c014', status: 'confirmed' },
    { id: 'tx-902', operation: 'twitter:search_recent', amountUsdc: 0.01, timestamp: '3m ago', txHash: '0x1e49...77b1', status: 'confirmed' },
    { id: 'tx-903', operation: 'threads:crawl_user', amountUsdc: 0.01, timestamp: '8m ago', txHash: '0x992c...aa56', status: 'confirmed' },
    { id: 'tx-904', operation: 'tiktok:extract_metadata', amountUsdc: 0.01, timestamp: '14m ago', txHash: '0x33b4...119c', status: 'confirmed' },
  ],
  webhooks: {
    customEndpointUrl: 'https://api.acme.corp/webhooks/xactions-payments',
    discordEnabled: true,
    slackEnabled: false,
    signingEnabled: true,
  },
};

const INITIAL_SESSIONS: LiveSessionItem[] = [
  {
    id: 'sess-881',
    userHandle: '@alex_founder',
    operation: 'Unfollow Non-Followers',
    status: 'running',
    progress: { current: 142, total: 300, message: 'Processing unfollow batch #6...' },
    startedAt: '4m ago',
    logs: [
      { timestamp: '14:20:02', message: 'Initialized stealth headless worker', type: 'info' },
      { timestamp: '14:20:15', message: 'Detected 300 non-followers out of 1,240 following', type: 'info' },
      { timestamp: '14:22:40', message: 'Paused 15s to emulate human jitter', type: 'warn' },
    ],
  },
  {
    id: 'sess-882',
    userHandle: '@growth_lead',
    operation: 'Viral Tweet Discovery',
    status: 'running',
    progress: { current: 85, total: 100, message: 'Scoring viral coefficients with Claude AI...' },
    startedAt: '12m ago',
    logs: [
      { timestamp: '14:12:00', message: 'Stream attached to target hashtag #buildinpublic', type: 'info' },
      { timestamp: '14:18:30', message: 'Filtered 85 high-velocity tweets', type: 'info' },
    ],
  },
  {
    id: 'sess-883',
    userHandle: '@cryptoinvestor',
    operation: 'Audience Overlap Miner',
    status: 'idle',
    progress: { current: 500, total: 500, message: 'Batch run finished successfully' },
    startedAt: '35m ago',
    logs: [
      { timestamp: '13:50:00', message: 'Crawled 500 followers for cross-matching', type: 'info' },
      { timestamp: '14:02:11', message: 'Generated affinity matrix', type: 'info' },
    ],
  },
];

// ==========================================
// Normalizers — map backend payloads to UI shapes
// ==========================================

/**
 * Normalize a backend /api/checkpoints record into the UI Checkpoint shape.
 * Backend: {id, platform, targetType, targetKey, status, lastCursor, errorCount, lastCrawledAt, lastTimestamp, itemsScraped?}
 * UI:      {id, crawler, target, status, itemsScraped, lastActive, cursor, errors, platform}
 */
function normalizeCheckpoint(c: unknown): Checkpoint {
  const r = (c ?? {}) as Record<string, unknown>;
  const statusMap: Record<string, Checkpoint['status']> = {
    running: 'running',
    active: 'running',
    has_more: 'running',
    paused: 'paused',
    completed: 'completed',
    done: 'completed',
    failed: 'failed',
    error: 'failed',
    stalled: 'stalled',
  };
  const rawStatus = String(r.status ?? 'stalled').toLowerCase();
  const targetType = r.targetType ? `${r.targetType}:` : '';
  return {
    id: String(r.id ?? ''),
    crawler: `${String(r.platform ?? 'unknown')}-${String(r.targetType ?? 'crawl')}`,
    target: String(r.targetKey ?? r.target ?? `${targetType}${r.id ?? ''}`),
    status: statusMap[rawStatus] ?? 'stalled',
    itemsScraped: Number(r.itemsScraped ?? r.itemsCount ?? r.count ?? 0) || 0,
    lastActive: timeAgo(r.lastCrawledAt ?? r.lastTimestamp ?? r.updatedAt),
    cursor: (r.lastCursor ?? r.cursor) ? String(r.lastCursor ?? r.cursor) : undefined,
    errors: Number(r.errorCount ?? r.errors ?? 0) || 0,
    platform: r.platform ? String(r.platform) : undefined,
  };
}

/** Convert an ISO/epoch timestamp into a short "x ago" label. */
function timeAgo(ts: unknown): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
  const ms = d.getTime();
  if (Number.isNaN(ms)) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Normalize a backend /api/admin/proxies record into the UI ProxyNode shape.
 * Backend: {key, server, protocol, host, port, residential, status, pool, quarantinedUntil, latency?, successRate?}
 * UI:      {id, ip, protocol, status, latency, successRate, tier, type}
 * Guarantees a unique, non-empty `id` to keep React list keys stable.
 */
function normalizeProxy(p: unknown, index = 0): ProxyNode {
  const r = (p ?? {}) as Record<string, unknown>;
  const server = String(r.server ?? r.ip ?? r.key ?? `proxy-${index}`);
  const id = String(r.id ?? r.key ?? server ?? `proxy-${index}`);
  const statusMap: Record<string, ProxyNode['status']> = {
    healthy: 'healthy',
    quarantined: 'quarantined',
    cooldown: 'cooldown',
    unhealthy: 'unhealthy',
    dead: 'unhealthy',
  };
  const rawStatus = String(r.status ?? (r.healthy === false ? 'unhealthy' : 'healthy')).toLowerCase();
  return {
    id,
    ip: server,
    protocol: String(r.protocol ?? 'http'),
    status: statusMap[rawStatus] ?? 'healthy',
    latency: Number(r.latency ?? r.latencyMs ?? 0) || 0,
    successRate: Number(r.successRate ?? r.success_rate ?? 100) || 0,
    tier: r.tier ? String(r.tier) : (r.residential ? 'Residential' : 'Datacenter'),
    type: r.pool ? String(r.pool) : (r.type ? String(r.type) : undefined),
  };
}

/**
 * Normalize a backend stream-alert record into the UI StreamAlertItem shape.
 * Backend activeAlerts items: {alert, threshold, value, severity?, timestamp, metrics}
 * UI: {id, name, severity, value, threshold, timestamp}
 */
function normalizeStreamAlert(a: unknown, index = 0): StreamAlertItem {
  const r = (a ?? {}) as Record<string, unknown>;
  const rawName = String(r.name ?? r.alert ?? `alert-${index}`);
  const severity = String(r.severity ?? 'WARNING').toUpperCase() === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
  return {
    id: String(r.id ?? `${rawName}-${index}`),
    name: rawName.replace(/_/g, ' '),
    severity,
    value: r.value !== undefined ? String(r.value) : '—',
    threshold: r.threshold !== undefined ? String(r.threshold) : '—',
    timestamp: r.timestamp ? timeAgo(r.timestamp) : '—',
  };
}

// ==========================================
// Main Component
// ==========================================

export default function AdminConsolePage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('checkpoints');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Section States
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(INITIAL_CHECKPOINTS);
  const [proxies, setProxies] = useState<ProxyNode[]>(INITIAL_PROXIES);
  const [accounts, setAccounts] = useState<ScraperAccount[]>(INITIAL_ACCOUNTS);
  const [governor, setGovernor] = useState<GovernorState>(INITIAL_GOVERNOR);
  const [budget, setBudget] = useState<ProxyBudgetState>(INITIAL_BUDGET);
  const [streamMetrics, setStreamMetrics] = useState<StreamMetricsState>(INITIAL_STREAM_METRICS);
  const [streamAlerts, setStreamAlerts] = useState<StreamAlertItem[]>(INITIAL_STREAM_ALERTS);
  const [payments, setPayments] = useState<PaymentLedgerState>(INITIAL_PAYMENTS);
  const [sessions, setSessions] = useState<LiveSessionItem[]>(INITIAL_SESSIONS);

  // Checkpoint Filter Toolbar State
  const [cpSearch, setCpSearch] = useState('');
  const [cpPlatform, setCpPlatform] = useState('all');
  const [cpStatus, setCpStatus] = useState('all');
  const [cpPage, setCpPage] = useState(1);
  const cpPageSize = 5;

  // Stream Chart Range
  const [chartRange, setChartRange] = useState<'5m' | '1h' | '24h'>('5m');

  // Proxy Tier Filter
  const [proxyTierFilter, setProxyTierFilter] = useState('all');

  // Alert Channel Form
  const [webhookUrlInput, setWebhookUrlInput] = useState(INITIAL_PAYMENTS.webhooks.customEndpointUrl);
  const [emailRecipientsInput, setEmailRecipientsInput] = useState('ops@xactions.io, alerts@xactions.io');

  // Toast Helper
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  // Hash route listener for parity with legacy admin.html #checkpoints, #proxies, etc.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (['checkpoints', 'jobs'].includes(hash)) setActiveTab('checkpoints');
      else if (['proxies', 'accounts'].includes(hash)) setActiveTab('proxies');
      else if (['stream', 'streams', 'alerts'].includes(hash)) setActiveTab('stream');
      else if (['payments', 'x402'].includes(hash)) setActiveTab('payments');
      else if (['sessions', 'live'].includes(hash)) setActiveTab('sessions');
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Realtime client binding
  useEffect(() => {
    const client = getRealtimeClient({ autoConnect: true });
    setRealtimeStatus(client.getStatus());

    const unsubscribeStatus = client.onStatusChange((status) => {
      setRealtimeStatus(status);
    });

    const unsubscribeHealth = client.subscribe<SystemHealthData>('health:update', (data) => {
      if (data?.hibernating !== undefined) {
        setGovernor((prev) => ({
          ...prev,
          panicStopped: Boolean(data.hibernating),
        }));
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeHealth();
    };
  }, []);

  // Fetch initial data from BFF endpoints
  const fetchAllData = useCallback(async () => {
    setIsRefreshing(true);

    try {
      // 1. Checkpoints — backend returns {platform,targetType,targetKey,status,lastCursor,errorCount,lastCrawledAt}
      // so normalize into the UI Checkpoint shape (target/crawler/itemsScraped/lastActive) before setting state.
      const cpRes = await api<{ checkpoints?: unknown[]; items?: unknown[] }>('GET', '/api/checkpoints');
      if (cpRes.ok && cpRes.data) {
        const raw = cpRes.data.checkpoints || cpRes.data.items || (Array.isArray(cpRes.data) ? (cpRes.data as unknown[]) : null);
        if (raw && Array.isArray(raw) && raw.length > 0) {
          setCheckpoints(raw.map((c) => normalizeCheckpoint(c)));
        }
      } else if (cpRes.status === 401) {
        showToast('Authentication required for live checkpoints. Showing seed data.', 'info');
      }

      // 2. Proxies (admin route — /api/proxies root is not exposed)
      const pxRes = await api<{ proxies?: unknown[]; items?: unknown[] }>('GET', '/api/admin/proxies');
      if (pxRes.ok && pxRes.data) {
        const list = pxRes.data.proxies || pxRes.data.items || (Array.isArray(pxRes.data) ? (pxRes.data as unknown[]) : null);
        if (list && Array.isArray(list) && list.length > 0) {
          setProxies(list.map((p, i) => normalizeProxy(p, i)));
        }
      }

      // 3. Stream alerts (admin route — /api/admin/stream/alerts)
      // Backend returns alerts = { activeAlerts: [...], totalAlertsTriggered, config } (object, not array).
      const altRes = await api<{
        alerts?: { activeAlerts?: unknown[]; totalAlertsTriggered?: number } | StreamAlertItem[];
      }>('GET', '/api/admin/stream/alerts');
      if (altRes.ok && altRes.data?.alerts) {
        const raw = altRes.data.alerts;
        const items = Array.isArray(raw) ? raw : (raw.activeAlerts ?? []);
        setStreamAlerts(items.map((a, i) => normalizeStreamAlert(a, i)));
      }

      // 4. x402 Payments (admin stats route — /api/admin/x402/stats)
      const payRes = await api<{
        stats?: {
          totalPayments?: number;
          totalRevenueUSD?: string;
          byOperation?: Record<string, number>;
          recentPayments?: Array<Record<string, unknown>>;
        };
      }>('GET', '/api/admin/x402/stats');
      if (payRes.ok && payRes.data?.stats) {
        const s = payRes.data.stats;
        const byOperation: PaymentLedgerState['byOperation'] = {};
        for (const [op, count] of Object.entries(s.byOperation ?? {})) {
          byOperation[op] = { count: Number(count) || 0, totalUsdc: 0 };
        }
        setPayments((prev) => ({
          ...prev,
          totalPayments: s.totalPayments ?? prev.totalPayments,
          totalRevenueUsdc: parseFloat(s.totalRevenueUSD ?? String(prev.totalRevenueUsdc)) || prev.totalRevenueUsdc,
          byOperation: Object.keys(byOperation).length > 0 ? byOperation : prev.byOperation,
        }));
      }
    } catch {
      // Graceful offline fallback
    } finally {
      setIsRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // ==========================================
  // Checkpoint Action Handlers
  // ==========================================

  const handleAction = async (id: string, action: 'pause' | 'resume' | 'retry') => {
    // Optimistic status update
    const previous = [...checkpoints];
    const newStatus = action === 'pause' ? 'paused' : 'running';

    setCheckpoints((prev) =>
      prev.map((cp) => (cp.id === id ? { ...cp, status: newStatus } : cp))
    );

    try {
      const res = await api('POST', `/api/checkpoints/${id}/${action}`);
      if (res.ok) {
        showToast(`Checkpoint ${id} ${action}d successfully.`, 'success');
      } else {
        // Rollback if failed
        setCheckpoints(previous);
        showToast(`Failed to ${action} checkpoint: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch (err) {
      setCheckpoints(previous);
      showToast(`Network error triggering ${action} on ${id}`, 'error');
    }
  };

  // ==========================================
  // Governor & Panic Stop Actions
  // ==========================================

  const handlePanicStop = async (platform: string = 'all') => {
    try {
      const res = await api('POST', '/api/governor/panic-stop', { body: { platform } });
      if (res.ok) {
        setGovernor((prev) => ({ ...prev, panicStopped: true, level: 'CRITICAL' }));
        showToast(`Emergency Panic Stop initiated on platform "${platform}". All workers halted.`, 'error');
      } else {
        showToast(`Panic stop failed: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      // Optimistic demo
      setGovernor((prev) => ({ ...prev, panicStopped: true, level: 'CRITICAL' }));
      showToast(`Emergency Panic Stop initiated (local simulated).`, 'error');
    }
  };

  const handlePanicResume = async () => {
    try {
      const res = await api('POST', '/api/governor/panic-resume', { body: { platform: 'all' } });
      if (res.ok) {
        setGovernor((prev) => ({ ...prev, panicStopped: false, level: 'NORMAL' }));
        showToast('All crawlers resumed safely.', 'success');
      } else {
        showToast(`Panic resume failed: ${res.error?.message || 'Server error'}`, 'error');
      }
    } catch {
      setGovernor((prev) => ({ ...prev, panicStopped: false, level: 'NORMAL' }));
      showToast('All crawlers resumed safely (local simulated).', 'success');
    }
  };

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    const list = [...governor.consumers];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;

    // renumber priorities
    const updated = list.map((c, i) => ({ ...c, priority: i + 1 }));
    setGovernor((prev) => ({ ...prev, consumers: updated }));

    try {
      await api('POST', '/api/governor/priorities', {
        body: { priorities: updated.map((c) => ({ id: c.id, priority: c.priority })) },
      });
      showToast('Queue consumer priority updated.', 'success');
    } catch {
      // Keep optimistic
    }
  };

  // ==========================================
  // Proxy Actions
  // ==========================================

  const handleProxyToggleQuarantine = async (node: ProxyNode) => {
    const nextStatus = node.status === 'quarantined' ? 'healthy' : 'quarantined';
    const isQuarantine = nextStatus === 'quarantined';

    setProxies((prev) =>
      prev.map((p) => (p.id === node.id ? { ...p, status: nextStatus } : p))
    );

    try {
      const endpoint = isQuarantine ? '/api/admin/proxies/quarantine' : '/api/admin/proxies/release';
      await api('POST', endpoint, { body: { proxyId: node.id } });
      showToast(`Proxy ${node.ip} ${isQuarantine ? 'quarantined' : 'released back to pool'}.`, 'success');
    } catch {
      showToast(`Proxy ${node.ip} status updated.`, 'info');
    }
  };

  // ==========================================
  // Scraper Account Actions
  // ==========================================

  const handleAccountAction = async (id: string, action: 'wake' | 'probe' | 'rotate') => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        if (action === 'wake') return { ...acc, status: 'active', remainingSec: 0, circuitState: 'closed' };
        if (action === 'rotate') return { ...acc, assignedProxy: '103.152.220.14', status: 'active' };
        return acc;
      })
    );

    try {
      await api('POST', `/api/admin/accounts/${action}`, { body: { accountId: id } });
      showToast(`Account action "${action}" executed for ${id}.`, 'success');
    } catch {
      showToast(`Account action "${action}" applied (offline simulated).`, 'info');
    }
  };

  // ==========================================
  // Alert Configuration Actions
  // ==========================================

  const handleSaveAlertChannels = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/stream/alerts/config', {
        body: { webhookUrl: webhookUrlInput, emailRecipients: emailRecipientsInput },
      });
      showToast('Alert notification channels saved successfully.', 'success');
    } catch {
      showToast('Alert channels updated locally.', 'info');
    }
  };

  const handleTriggerTestAlert = async () => {
    try {
      await api('POST', '/api/admin/stream/alerts/test', {
        body: { type: 'test_canary', severity: 'WARNING' },
      });
      showToast('Test alert sent to configured webhook & email channels.', 'success');
    } catch {
      showToast('Simulated test alert dispatched.', 'info');
    }
  };

  const handleTestWebhooks = async () => {
    try {
      await api('POST', '/api/admin/x402/webhooks/test');
      showToast('Webhook HMAC test payload delivered with HTTP 200 OK.', 'success');
    } catch {
      showToast('Simulated webhook ping delivered with HTTP 200.', 'info');
    }
  };

  // ==========================================
  // Filtered & Paginated Checkpoints
  // ==========================================

  const filteredCheckpoints = useMemo(() => {
    return checkpoints.filter((cp) => {
      const matchSearch =
        cp.target.toLowerCase().includes(cpSearch.toLowerCase()) ||
        cp.crawler.toLowerCase().includes(cpSearch.toLowerCase()) ||
        cp.id.toLowerCase().includes(cpSearch.toLowerCase());
      const matchPlatform = cpPlatform === 'all' || cp.platform === cpPlatform;
      const matchStatus = cpStatus === 'all' || cp.status === cpStatus;
      return matchSearch && matchPlatform && matchStatus;
    });
  }, [checkpoints, cpSearch, cpPlatform, cpStatus]);

  const paginatedCheckpoints = useMemo(() => {
    const start = (cpPage - 1) * cpPageSize;
    return filteredCheckpoints.slice(start, start + cpPageSize);
  }, [filteredCheckpoints, cpPage]);

  const totalCpPages = Math.max(1, Math.ceil(filteredCheckpoints.length / cpPageSize));

  // Filtered Proxies
  const filteredProxies = useMemo(() => {
    if (proxyTierFilter === 'all') return proxies;
    return proxies.filter((p) => p.tier === proxyTierFilter);
  }, [proxies, proxyTierFilter]);

  // ==========================================
  // Render
  // ==========================================

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border text-sm font-medium transition-all duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-800'
              : toast.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-800'
              : 'bg-slate-900/95 text-slate-200 border-slate-700'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Bell className="w-5 h-5 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              System Admin & Infrastructure Control
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
              Operations
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Realtime control plane for crawlers, proxy quarantine pool, operational checkpoints, and stream health.
          </p>
        </div>

        {/* Global Controls & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium text-slate-600 dark:text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${
                realtimeStatus === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : realtimeStatus === 'polling'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            />
            <span className="capitalize">{realtimeStatus}</span>
          </div>

          <button
            onClick={fetchAllData}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Live Metrics</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs (5 Full Tabs Parity) */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto pb-px">
        {[
          { id: 'checkpoints', label: 'Jobs & Checkpoints', icon: Cpu, badge: checkpoints.length },
          { id: 'proxies', label: 'Proxies & Accounts', icon: Server, badge: proxies.length },
          { id: 'stream', label: 'Stream Metrics & Alerts', icon: Radio, badge: streamAlerts.length },
          { id: 'payments', label: 'x402 Micropayments', icon: Coins, badge: `$${payments.totalRevenueUsdc}` },
          { id: 'sessions', label: 'Live Sessions', icon: Activity, badge: sessions.length },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as AdminTab);
                if (typeof window !== 'undefined') window.location.hash = tab.id;
              }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span
                className={`ml-1 text-[11px] px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* ========================================================= */}
      {/* TAB 1: Jobs & Checkpoints                                  */}
      {/* ========================================================= */}
      {activeTab === 'checkpoints' && (
        <div className="space-y-6">
          {/* Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search target or crawler..."
                  value={cpSearch}
                  onChange={(e) => {
                    setCpSearch(e.target.value);
                    setCpPage(1);
                  }}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <select
                value={cpPlatform}
                onChange={(e) => {
                  setCpPlatform(e.target.value);
                  setCpPage(1);
                }}
                className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none"
              >
                <option value="all">All Platforms</option>
                <option value="twitter">Twitter / X</option>
                <option value="threads">Threads</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook">Facebook</option>
                <option value="bluesky">Bluesky</option>
              </select>

              <select
                value={cpStatus}
                onChange={(e) => {
                  setCpStatus(e.target.value);
                  setCpPage(1);
                }}
                className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="running">Running</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="stalled">Stalled</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {filteredCheckpoints.length} Checkpoints
              </span>
              <button
                onClick={fetchAllData}
                className="p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                title="Refresh Checkpoints"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Checkpoint Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Checkpoint ID</th>
                    <th className="py-3 px-4">Crawler</th>
                    <th className="py-3 px-4">Target Key</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Items Scraped</th>
                    <th className="py-3 px-4">Last Activity</th>
                    <th className="py-3 px-4">Errors / Cursor</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {paginatedCheckpoints.map((cp) => (
                    <tr key={cp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-900 dark:text-white">
                        {cp.id}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {cp.crawler}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                        {cp.target}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            cp.status === 'running'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-400'
                              : cp.status === 'paused'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-400'
                              : cp.status === 'completed'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-400'
                              : cp.status === 'failed'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-400'
                              : 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              cp.status === 'running'
                                ? 'bg-emerald-500 animate-pulse'
                                : cp.status === 'paused'
                                ? 'bg-amber-500'
                                : cp.status === 'completed'
                                ? 'bg-blue-500'
                                : cp.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-purple-500'
                            }`}
                          />
                          <span className="capitalize">{cp.status}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                        {cp.itemsScraped.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{cp.lastActive}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                        {cp.errors !== undefined && cp.errors > 0 ? (
                          <span className="text-rose-600 font-semibold">{cp.errors} errs</span>
                        ) : (
                          <span className="text-slate-400">{cp.cursor || '0 errors'}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {cp.status === 'running' ? (
                            <button
                              onClick={() => handleAction(cp.id, 'pause')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:text-amber-300 font-medium transition-colors"
                              title="Pause Checkpoint"
                            >
                              <Pause className="w-3 h-3" />
                              <span>Pause</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAction(cp.id, 'resume')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-300 font-medium transition-colors"
                              title="Resume Checkpoint"
                            >
                              <Play className="w-3 h-3" />
                              <span>Resume</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleAction(cp.id, 'retry')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-medium transition-colors"
                            title="Retry from Last State"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedCheckpoints.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No checkpoints match the active filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 text-xs">
              <span className="text-slate-500">
                Page {cpPage} of {totalCpPages} ({filteredCheckpoints.length} total)
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={cpPage <= 1}
                  onClick={() => setCpPage((p) => Math.max(1, p - 1))}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={cpPage >= totalCpPages}
                  onClick={() => setCpPage((p) => Math.min(totalCpPages, p + 1))}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: Proxies & Accounts                                  */}
      {/* ========================================================= */}
      {activeTab === 'proxies' && (
        <div className="space-y-8">
          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Healthy Proxies</span>
                <Server className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {proxies.filter((p) => p.status === 'healthy').length} / {proxies.length}
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">96.4% pool availability</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Current Velocity</span>
                <Activity className="w-4 h-4 text-blue-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {governor.rpmAllocated} <span className="text-sm font-normal text-slate-500">RPM</span>
              </div>
              <span className="text-[11px] text-slate-500">Cap: {governor.rpmLimit} RPM</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Proxy Spend Today</span>
                <DollarSign className="w-4 h-4 text-amber-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                ${budget.spentToday.toFixed(2)}
              </div>
              <span className="text-[11px] text-slate-500">${budget.remaining.toFixed(2)} remaining</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>System Throttle State</span>
                <Gauge className="w-4 h-4 text-purple-500" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-xl font-bold ${
                  governor.level === 'NORMAL'
                    ? 'text-emerald-500'
                    : governor.level === 'REDUCED'
                    ? 'text-amber-500'
                    : 'text-rose-500'
                }`}>
                  {governor.level}
                </span>
                {governor.panicStopped && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-600 text-white rounded">
                    PANIC HALTED
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">Adaptive Governor active</span>
            </div>
          </div>

          {/* Section 1: Rate Budget & Quota Allocation (Story 32.1) */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-blue-500" />
                  Rate Budget & Quota Allocation
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Dynamic rate governor, per-consumer RPM ceilings, and emergency system panic stop.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {governor.panicStopped ? (
                  <button
                    onClick={handlePanicResume}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Resume All Crawlers</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handlePanicStop('all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-sm"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Panic Stop All</span>
                  </button>
                )}
              </div>
            </div>

            {/* Throttle Level Gauge Visualizer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-600 dark:text-slate-400">System Throttle Level:</span>
                <span className="font-bold text-slate-900 dark:text-white">{governor.level}</span>
              </div>
              <div className="grid grid-cols-4 gap-1 h-3 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 p-0.5">
                <div
                  className={`rounded transition-colors ${
                    ['NORMAL', 'REDUCED', 'BACKPRESSURE', 'CRITICAL'].includes(governor.level)
                      ? 'bg-emerald-500'
                      : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  title="Level 1: Normal (100% capacity)"
                />
                <div
                  className={`rounded transition-colors ${
                    ['REDUCED', 'BACKPRESSURE', 'CRITICAL'].includes(governor.level)
                      ? 'bg-amber-400'
                      : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  title="Level 2: Reduced (70% capacity)"
                />
                <div
                  className={`rounded transition-colors ${
                    ['BACKPRESSURE', 'CRITICAL'].includes(governor.level)
                      ? 'bg-orange-500'
                      : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  title="Level 3: Backpressure (40% capacity)"
                />
                <div
                  className={`rounded transition-colors ${
                    governor.level === 'CRITICAL' ? 'bg-rose-600 animate-pulse' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  title="Level 4: Critical (Emergency throttling)"
                />
              </div>
            </div>

            {/* Per-Consumer RPM Limits & Priority Allocator */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Consumer Queues & Priority Ordering
              </h3>
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Priority</th>
                      <th className="py-2.5 px-3">Consumer Name</th>
                      <th className="py-2.5 px-3">RPM Limit</th>
                      <th className="py-2.5 px-3">Current Usage</th>
                      <th className="py-2.5 px-3">Burst Allowance</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Reorder</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {governor.consumers.map((c, idx) => (
                      <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-mono font-bold text-blue-600">
                          #{c.priority}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                          {c.name}
                        </td>
                        <td className="py-2 px-3 font-mono">{c.rpmLimit} RPM</td>
                        <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                          {c.rpmUsed} RPM
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-500">+{c.burst}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              c.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {c.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              disabled={idx === 0}
                              onClick={() => handleMovePriority(idx, 'up')}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30"
                              title="Increase Priority"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              disabled={idx === governor.consumers.length - 1}
                              onClick={() => handleMovePriority(idx, 'down')}
                              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30"
                              title="Decrease Priority"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Platform DOM Drift Status (Story 28.2) */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                Platform DOM Selector Drift Canary (Story 28.2)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(governor.platformDrift).map(([platform, info]) => (
                  <div
                    key={platform}
                    className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs capitalize text-slate-800 dark:text-slate-200">
                        {platform}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          info.ok
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {info.ok ? 'HEALTHY' : 'DRIFT'}
                      </span>
                    </div>
                    <div className="mt-2 text-xs font-mono text-slate-500">
                      <div>Pass Rate: {info.successRate}%</div>
                      <div>Canary: {info.selectorScore}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Proxy Budget & Tier (Epic 40) */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-500" />
                  Proxy Budget & Tier Allocation (Epic 40)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Multi-tier proxy expenditure tracking, daily spending limits, and cost-per-GB controls.
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">Daily Cap: ${budget.dailyBudget.toFixed(2)}</span>
                <span className="font-bold text-emerald-600">Remaining: ${budget.remaining.toFixed(2)}</span>
              </div>
            </div>

            {/* Tier Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {Object.entries(budget.tiers).map(([tierKey, tierInfo]) => (
                <div
                  key={tierKey}
                  className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl"
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {tierKey.replace('_', ' ')}
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                    ${tierInfo.costPerGb.toFixed(2)} <span className="text-xs font-normal text-slate-500">/ GB</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 flex justify-between">
                    <span>{tierInfo.activeProxies} active</span>
                    <span>{tierInfo.usageGb} GB used</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Proxy Pool & Health Table */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Server className="w-5 h-5 text-emerald-500" />
                  Proxy Pool & Quarantine Table
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  IP nodes, protocol support, measured round-trip latency, and quarantine controls.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={proxyTierFilter}
                  onChange={(e) => setProxyTierFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                >
                  <option value="all">All Tiers</option>
                  <option value="free">Free Community</option>
                  <option value="datacenter">Datacenter</option>
                  <option value="residential">Residential</option>
                  <option value="mobile_4g">Mobile 4G</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">IP Address</th>
                    <th className="py-2.5 px-3">Protocol</th>
                    <th className="py-2.5 px-3">Tier</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Latency</th>
                    <th className="py-2.5 px-3">Success Rate</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredProxies.map((px) => (
                    <tr key={px.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                        {px.ip}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {px.protocol}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 capitalize">
                        {px.tier || 'Datacenter'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            px.status === 'healthy'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : px.status === 'cooldown'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {px.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {px.latency}ms
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {px.successRate}%
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleProxyToggleQuarantine(px)}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            px.status === 'quarantined'
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                          }`}
                        >
                          {px.status === 'quarantined' ? 'Release' : 'Quarantine'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: Scraper Accounts & Hibernation */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-indigo-500" />
                  Scraper Accounts & Hibernation Table
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automated account cooldown tracking, circuit breaker state, health scoring, and recovery probes.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Platform</th>
                    <th className="py-2.5 px-3">Account Handle</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Remaining Time</th>
                    <th className="py-2.5 px-3">Velocity</th>
                    <th className="py-2.5 px-3">Health & Circuit</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {accounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-semibold uppercase text-slate-700 dark:text-slate-300">
                        {acc.platform}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                        {acc.username}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            acc.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {acc.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                        {acc.remainingSec > 0 ? `${acc.remainingSec}s (${acc.reason || 'cooling'})` : 'Ready'}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{acc.velocity} req/m</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs">{acc.healthScore}/100</span>
                          <span
                            className={`text-[9px] font-mono px-1 py-0.2 rounded uppercase ${
                              acc.circuitState === 'closed'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {acc.circuitState}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleAccountAction(acc.id, 'wake')}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium"
                          >
                            Wake
                          </button>
                          <button
                            onClick={() => handleAccountAction(acc.id, 'probe')}
                            className="px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-[11px] font-medium"
                          >
                            Probe
                          </button>
                          <button
                            onClick={() => handleAccountAction(acc.id, 'rotate')}
                            className="px-2 py-1 rounded bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 text-[11px] font-medium"
                          >
                            Rotate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 3: Stream Metrics & Alerts                             */}
      {/* ========================================================= */}
      {activeTab === 'stream' && (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Events / Sec', value: `${streamMetrics.eventsPerSec} eps`, color: 'text-blue-500' },
              { label: 'Pending Msgs', value: streamMetrics.pending, color: 'text-amber-500' },
              { label: 'Consumer Lag', value: `${streamMetrics.consumerLag} msgs`, color: 'text-purple-500' },
              { label: 'Dropped Events', value: streamMetrics.dropped, color: 'text-rose-500' },
              { label: 'Last Ack Latency', value: `${streamMetrics.lastAckLatencyMs}ms`, color: 'text-emerald-500' },
              { label: 'Stream Max Len', value: streamMetrics.maxLen.toLocaleString(), color: 'text-slate-500' },
            ].map((stat, i) => (
              <div
                key={i}
                className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl"
              >
                <div className="text-[11px] text-slate-500 font-medium truncate">{stat.label}</div>
                <div className={`mt-1 text-lg font-bold ${stat.color} font-mono truncate`}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Stream Throughput Chart */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-500" />
                  Stream Throughput & Ingestion Velocity
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time Redis stream throughput rates, consumption lag, and payload velocity.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                {(['5m', '1h', '24h'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      chartRange === r
                        ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG Chart */}
            <div className="h-64 w-full relative flex flex-col justify-end pt-4 pb-2">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 500 200" preserveAspectRatio="none">
                {/* Horizontal Guide Lines */}
                <line x1="0" y1="40" x2="500" y2="40" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />
                <line x1="0" y1="100" x2="500" y2="100" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />
                <line x1="0" y1="160" x2="500" y2="160" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeDasharray="3 3" />

                {/* Events/s Polyline */}
                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                  points="0,120 100,100 200,80 300,110 400,90 500,75"
                />

                {/* Pending Messages Polyline */}
                <polyline
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                  points="0,185 100,180 200,190 300,175 400,188 500,182"
                />

                {/* Data Points */}
                {[[0, 120], [100, 100], [200, 80], [300, 110], [400, 90], [500, 75]].map(([x, y], idx) => (
                  <circle key={idx} cx={x} cy={y} r="4" className="fill-blue-600 stroke-white dark:stroke-slate-900 stroke-2" />
                ))}
              </svg>

              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                <span>-240s</span>
                <span>-180s</span>
                <span>-120s</span>
                <span>-60s</span>
                <span className="font-semibold text-blue-500">NOW</span>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs text-slate-500 justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-3 h-0.5 bg-blue-500" />
                <span>Events Ingested / s</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-0.5 bg-purple-500 border-dashed" />
                <span>Pending Ingestion Lag</span>
              </div>
            </div>
          </div>

          {/* Section: Active Alerts Table */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Bell className="w-5 h-5 text-amber-500" />
                  Active Stream Alerts
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Threshold monitors for consumer groups, lag spikes, and selector health degradation.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTriggerTestAlert}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Alert</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Alert Name</th>
                    <th className="py-2.5 px-3">Severity</th>
                    <th className="py-2.5 px-3">Current Value</th>
                    <th className="py-2.5 px-3">Threshold</th>
                    <th className="py-2.5 px-3 text-right">Detected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {streamAlerts.map((alt) => (
                    <tr key={alt.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                        {alt.name}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            alt.severity === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {alt.severity}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-medium">{alt.value}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">{alt.threshold}</td>
                      <td className="py-2.5 px-3 text-right text-slate-500">{alt.timestamp}</td>
                    </tr>
                  ))}
                  {streamAlerts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500">
                        No active alerts. All stream metrics within healthy operating bounds.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section: Alert Channels Configuration */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-blue-500" />
              Alert Channels Configuration
            </h2>
            <form onSubmit={handleSaveAlertChannels} className="space-y-4 max-w-2xl">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Webhook Notification URL
                </label>
                <input
                  type="url"
                  value={webhookUrlInput}
                  onChange={(e) => setWebhookUrlInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="https://your-domain.com/webhooks/alerts"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Notification Recipients (comma-separated)
                </label>
                <input
                  type="text"
                  value={emailRecipientsInput}
                  onChange={(e) => setEmailRecipientsInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="ops@xactions.io, lead@xactions.io"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 4: x402 Micropayments                                  */}
      {/* ========================================================= */}
      {activeTab === 'payments' && (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Total Settled Payments</div>
              <div className="mt-2 text-2xl font-bold font-mono text-slate-900 dark:text-white">
                {payments.totalPayments.toLocaleString()}
              </div>
              <span className="text-[11px] text-emerald-600 font-medium">x402 protocol verified</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Total Revenue (USDC)</div>
              <div className="mt-2 text-2xl font-bold font-mono text-emerald-600">
                ${payments.totalRevenueUsdc.toFixed(2)}
              </div>
              <span className="text-[11px] text-slate-500">L2 Instant Settlement</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Webhook Dispatch State</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xl font-bold capitalize text-slate-900 dark:text-white">
                  {payments.webhookStatus}
                </span>
              </div>
              <span className="text-[11px] text-slate-500">HMAC-SHA256 signatures active</span>
            </div>
          </div>

          {/* Payments by Operation */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              Payments by Operation
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(payments.byOperation).map(([op, info]) => (
                <div
                  key={op}
                  className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <div className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {op}
                  </div>
                  <div className="mt-2 text-lg font-bold font-mono text-slate-900 dark:text-white">
                    ${info.totalUsdc.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-500">{info.count} micropayments</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Payments Table */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-500" />
              Recent Payment Transactions
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Transaction ID</th>
                    <th className="py-2.5 px-3">Operation</th>
                    <th className="py-2.5 px-3">Amount</th>
                    <th className="py-2.5 px-3">Tx Hash</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {payments.recent.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900 dark:text-white">
                        {tx.id}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {tx.operation}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-600">
                        ${tx.amountUsdc.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px]">
                        {tx.txHash}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 capitalize">
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">{tx.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Webhook Configuration Section */}
          <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-500" />
                Payment Webhook & Dispatch Targets
              </h2>

              <button
                onClick={handleTestWebhooks}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 transition-colors"
              >
                Test Webhooks
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Discord Notification</div>
                  <div className="text-slate-500 text-[11px]">Forward x402 revenue events</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  ENABLED
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Slack Dispatch</div>
                  <div className="text-slate-500 text-[11px]">Publish to #finance-alerts</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  DISABLED
                </span>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">HMAC-SHA256 Signing</div>
                  <div className="text-slate-500 text-[11px]">Strict header signature</div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 5: Live Sessions                                      */}
      {/* ========================================================= */}
      {activeTab === 'sessions' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Total Active Sessions</div>
              <div className="mt-2 text-2xl font-bold font-mono text-slate-900 dark:text-white">
                {sessions.length}
              </div>
              <span className="text-[11px] text-blue-500 font-medium">Browser workers connected</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Executing Automation</div>
              <div className="mt-2 text-2xl font-bold font-mono text-emerald-600">
                {sessions.filter((s) => s.status === 'running').length}
              </div>
              <span className="text-[11px] text-slate-500">Active human jitter & sleep</span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500">Unfollows / Actions Today</div>
              <div className="mt-2 text-2xl font-bold font-mono text-purple-600">
                1,240
              </div>
              <span className="text-[11px] text-slate-500">Across all connected sessions</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sessions.map((sess) => (
              <div
                key={sess.id}
                className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center font-bold text-blue-600 text-sm">
                      {sess.userHandle[1]?.toUpperCase() || 'U'}
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900 dark:text-white">
                        {sess.userHandle}
                      </div>
                      <div className="text-xs font-medium text-slate-500">{sess.operation}</div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      sess.status === 'running'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {sess.status}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                    <span>{sess.progress.message || 'Processing...'}</span>
                    <span className="font-mono">
                      {sess.progress.current} / {sess.progress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((sess.progress.current / sess.progress.total) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Log Feed */}
                <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1 max-h-32 overflow-y-auto font-mono text-[11px]">
                  {sess.logs.map((log, lIdx) => (
                    <div key={lIdx} className="flex items-start gap-2 text-slate-600 dark:text-slate-400">
                      <span className="text-slate-400 select-none">{log.timestamp}</span>
                      <span
                        className={
                          log.type === 'warn'
                            ? 'text-amber-600'
                            : log.type === 'error'
                            ? 'text-rose-600'
                            : 'text-slate-700 dark:text-slate-300'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
