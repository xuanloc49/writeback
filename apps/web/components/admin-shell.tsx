'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { googleSignOutUrl } from '../lib/auth-urls';
import { adminNavItems, adminRedirect, canAccessAdminPath } from '../lib/admin-gate';
import { API_URL, APP_ORIGIN } from '../lib/config';
import { ForbiddenNotice } from './admin-ui';
import { MeProvider, TosGate, useMe } from './session';
import { ErrorBanner } from './ui';

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <MeProvider>
      <AdminChrome>{children}</AdminChrome>
    </MeProvider>
  );
}

function AdminChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, loadError, refresh } = useMe();

  useEffect(() => {
    if (loading) {
      return;
    }
    const dest = adminRedirect(me, pathname);
    if (dest !== null && dest !== pathname) {
      router.replace(dest);
    }
  }, [loading, me, pathname, router]);

  if (loading) {
    return <p className="px-4 py-8">Đang tải…</p>;
  }
  if (me === null || me.impersonatorId) {
    return <p className="px-4 py-8">Đang chuyển trang…</p>;
  }

  const showTos = me.learningBlockedReason === 'TOS_REQUIRED';
  const allowed = canAccessAdminPath(me.role, pathname);
  const nav = adminNavItems(me.role);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/admin" className="font-serif text-lg text-ink">
            WriteBack Admin
          </Link>
          {nav.length > 0 ? (
            <nav className="flex flex-wrap gap-x-3 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={
                    item.href === '/admin'
                      ? pathname === '/admin'
                        ? 'page'
                        : undefined
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)
                        ? 'page'
                        : undefined
                  }
                  className={
                    item.href === '/admin'
                      ? pathname === '/admin'
                        ? 'font-medium'
                        : ''
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)
                        ? 'font-medium'
                        : ''
                  }
                >
                  {item.label}
                </Link>
              ))}
              <Link href="/app">Học</Link>
            </nav>
          ) : null}
          {me ? (
            <a className="ml-auto text-sm" href={googleSignOutUrl(API_URL, APP_ORIGIN)}>
              Đăng xuất
            </a>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {loadError ? <ErrorBanner message={loadError} /> : null}
        {showTos ? <TosGate onAccepted={refresh} /> : allowed ? children : <ForbiddenNotice />}
      </main>
    </div>
  );
}
