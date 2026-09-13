import { isStaffRole, type MeDto, type Role } from '@writeback/shared';

export type AdminNavItem = { href: string; label: string; roles: readonly Role[] };

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/admin', label: 'Tổng quan', roles: ['editor', 'support', 'admin'] },
  { href: '/admin/topics', label: 'Chủ đề', roles: ['editor', 'admin'] },
  { href: '/admin/lemmas', label: 'Từ', roles: ['editor', 'admin'] },
  { href: '/admin/prompts', label: 'Câu', roles: ['editor', 'admin'] },
  { href: '/admin/import', label: 'Import', roles: ['editor', 'admin'] },
  { href: '/admin/users', label: 'Người dùng', roles: ['support', 'admin'] },
  { href: '/admin/allowlist', label: 'Allowlist', roles: ['admin'] },
  { href: '/admin/audit', label: 'Audit', roles: ['support', 'admin'] },
];

export function adminNavItems(role: Role): { href: string; label: string }[] {
  return ADMIN_NAV.filter((item) => item.roles.includes(role)).map(({ href, label }) => ({
    href,
    label,
  }));
}

export function canAccessAdminPath(role: Role, pathname: string): boolean {
  if (!isStaffRole(role)) {
    return false;
  }
  const item = matchAdminNav(pathname);
  return item !== null && item.roles.includes(role);
}

export function adminRedirect(me: MeDto | null, pathname: string): string | null {
  if (!pathname.startsWith('/admin')) {
    return null;
  }
  if (me === null) {
    return '/login';
  }
  if (me.impersonatorId) {
    return '/app';
  }
  return null;
}

function matchAdminNav(pathname: string): AdminNavItem | null {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const matches = ADMIN_NAV.filter(
    (item) => normalized === item.href || normalized.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best));
}
