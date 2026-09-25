// by nichxbt
// Single source of truth for dashboard navigation — consumed by the sidebar,
// the ⌘K command palette, and the breadcrumb. One edit updates all three.
import {
  LayoutDashboard, BarChart3, Search, Network, TrendingUp, Database,
  Workflow, Zap, Calendar, Terminal, MessageSquare, Bot,
  Layers, Sparkles, Flame, Brain, Code2, Gamepad2, Video,
  Users, UserMinus, Globe, UserCog, KeyRound, ShieldCheck,
  Activity, HeartPulse, ShieldAlert, Puzzle, FlaskConical, FileCode2, Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  keywords?: string[];   // extra ⌘K search terms
  badge?: 'Live' | 'AI' | 'Ops';
  external?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;          // set only for the single-link Overview "group"
  badge?: 'Live' | 'AI' | 'Ops';
  items: NavItem[];
  defaultCollapsed?: boolean; // System starts collapsed
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview', label: 'Overview', icon: LayoutDashboard, href: '/', items: [],
  },
  {
    id: 'intelligence', label: 'Intelligence', icon: BarChart3, items: [
      { label: 'Analytics', href: '/analytics', keywords: ['stats', 'metrics'] },
      { label: 'OSINT Lookup', href: '/osint', keywords: ['search', 'profile', 'find'] },
      { label: 'Social Graph', href: '/graph', keywords: ['network', 'connections'] },
      { label: 'Price Correlation', href: '/price-correlation', keywords: ['crypto', 'market'] },
      { label: 'Benchmark', href: '/benchmark', keywords: ['compare', 'test'] },
      { label: 'Universal Explorer', href: '/explorer', keywords: ['scrape', 'platforms', 'facebook', 'cho tot', 'batdongsan'] },
      { label: 'Facebook', href: '/facebook', keywords: ['meta', 'fb', 'scraper'] },
    ],
  },
  {
    id: 'automation', label: 'Automation', icon: Workflow, items: [
      { label: 'Workflows', href: '/workflows', keywords: ['pipeline', 'steps'] },
      { label: 'Automations', href: '/automations', keywords: ['rules', 'trigger'] },
      { label: 'Scheduler', href: '/scheduler', keywords: ['cron', 'jobs', 'schedule'] },
      { label: 'Calendar', href: '/calendar', keywords: ['plan', 'queue'] },
      { label: 'Run Console', href: '/run', keywords: ['execute', 'terminal'] },
      { label: 'A2A Console', href: '/a2a', keywords: ['agent', 'protocol', 'stream'] },
      { label: 'Agent Persona', href: '/agent', keywords: ['persona', 'character', 'voice'] },
    ],
  },
  {
    id: 'content', label: 'Content & AI', icon: Sparkles, badge: 'AI', items: [
      { label: 'Thread Composer', href: '/thread-composer', keywords: ['write', 'draft', 'thread'] },
      { label: 'Threads', href: '/thread', keywords: ['posts'] },
      { label: 'Tweet Schedule', href: '/tweet-schedule', keywords: ['queue', 'post'] },
      { label: 'Content Optimizer', href: '/optimizer', keywords: ['improve', 'score'] },
      { label: 'Viral DNA Miner', href: '/viral-miner', badge: 'AI', keywords: ['viral', 'patterns'] },
      { label: 'Video Download', href: '/video', keywords: ['media', 'download'] },
      { label: 'AI Dashboard', href: '/ai', keywords: ['models', 'status', 'llm'] },
      { label: 'AI API', href: '/ai-api', keywords: ['endpoints', 'keys'] },
      { label: 'Playground', href: '/playground', keywords: ['test', 'generate', 'prompt'] },
    ],
  },
  {
    id: 'audience', label: 'Audience', icon: Users, items: [
      { label: 'Follower CRM', href: '/crm', keywords: ['followers', 'contacts', 'tags'] },
      { label: 'Unfollowers', href: '/unfollowers', keywords: ['lost', 'churn'] },
      { label: 'Accounts', href: '/accounts', keywords: ['profiles', 'logins'] },
      { label: 'Sessions', href: '/sessions', keywords: ['cookies', 'auth'] },
      { label: 'Proxies', href: '/proxies', keywords: ['ip', 'proxy', 'network'] },
      { label: 'Platforms', href: '/platform', keywords: ['connections', 'twitter', 'bluesky'] },
    ],
  },
  {
    id: 'system', label: 'System', icon: Settings, badge: 'Ops', defaultCollapsed: true, items: [
      { label: 'Monitor', href: '/monitor', badge: 'Live', keywords: ['live', 'realtime', 'jobs'] },
      { label: 'Status', href: '/status', keywords: ['health', 'uptime'] },
      { label: 'Security', href: '/security', keywords: ['vulnerabilities', 'audit'] },
      { label: 'MCP Inspector', href: '/mcp', keywords: ['tools', 'protocol'] },
      { label: 'Jev Test', href: '/jev-test', keywords: ['judge', 'variant'] },
      { label: 'Extension', href: '/extension', keywords: ['chrome', 'browser'] },
      { label: 'API Docs', href: '/api-docs/', external: true, keywords: ['swagger', 'openapi'] },
      { label: 'Settings', href: '/settings', keywords: ['config', 'theme', 'keys'] },
    ],
  },
];

/** Flattened, palette-searchable index of every leaf route. */
export interface NavIndexEntry {
  label: string;
  href: string;
  groupId: string;
  groupLabel: string;
  keywords: string[];
  badge?: string;
  external?: boolean;
}

export const NAV_INDEX: NavIndexEntry[] = NAV_GROUPS.flatMap((g): NavIndexEntry[] =>
  g.items.length
    ? g.items.map((it): NavIndexEntry => ({
        label: it.label, href: it.href, groupId: g.id, groupLabel: g.label,
        keywords: it.keywords ?? [], badge: it.badge, external: it.external,
      }))
    : g.href
    ? [{ label: g.label, href: g.href, groupId: g.id, groupLabel: g.label, keywords: [] }]
    : [],
);

/** High-value actions surfaced in the palette alongside routes. */
export const NAV_ACTIONS = [
  { label: 'New Workflow', href: '/workflows?new=1', groupLabel: 'Action', keywords: ['create', 'workflow'] },
  { label: 'New Automation', href: '/automations?new=1', groupLabel: 'Action', keywords: ['create', 'automation'] },
  { label: 'Schedule a Job', href: '/scheduler?new=1', groupLabel: 'Action', keywords: ['create', 'cron', 'job'] },
  { label: 'Compose Thread', href: '/thread-composer', groupLabel: 'Action', keywords: ['write', 'draft'] },
];

/** Find the group that owns a pathname (for breadcrumb + auto-expand). */
export function groupForPath(pathname: string): NavGroup | undefined {
  if (pathname === '/') return NAV_GROUPS[0];
  const clean = pathname.replace(/\/+$/, '');
  return NAV_GROUPS.find((g) => g.items.some((it) => it.href.replace(/\/+$/, '') === clean));
}

/** Find the item label for a pathname (for breadcrumb leaf). */
export function itemForPath(pathname: string): NavItem | undefined {
  const clean = pathname.replace(/\/+$/, '');
  for (const g of NAV_GROUPS) {
    const hit = g.items.find((it) => it.href.replace(/\/+$/, '') === clean);
    if (hit) return hit;
  }
  return undefined;
}
