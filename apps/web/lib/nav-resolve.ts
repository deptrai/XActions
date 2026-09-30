// by nichxbt — pure pathname→nav lookups (no React/icons) so they are
// executable-testable in the Node test env. nav.ts delegates to these.

export interface NavItemLike {
  label: string;
  href: string;
  external?: boolean;
}

export interface NavGroupLike {
  id: string;
  label: string;
  items: NavItemLike[];
}

/** Strip trailing slashes so '/jobs-vn/' and '/jobs-vn' resolve identically. */
export function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

/** Group owning the item at `pathname`, or the first group for '/'. */
export function findGroupForPath<T extends NavGroupLike>(groups: T[], pathname: string): T | undefined {
  if (pathname === '/') return groups[0];
  const clean = normalizePath(pathname);
  return groups.find((g) => g.items.some((it) => normalizePath(it.href) === clean));
}

/** Nav item at `pathname` (breadcrumb leaf), searched across all groups. */
export function findItemForPath<T extends NavItemLike>(groups: NavGroupLike[], pathname: string): T | undefined {
  const clean = normalizePath(pathname);
  for (const g of groups) {
    const hit = (g.items as T[]).find((it) => normalizePath(it.href) === clean);
    if (hit) return hit;
  }
  return undefined;
}
