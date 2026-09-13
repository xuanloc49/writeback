'use client';

import Link from 'next/link';
import { adminNavItems } from '../../lib/admin-gate';
import { Card } from '../../components/ui';
import { useMe } from '../../components/session';

export default function AdminHomePage() {
  const { me } = useMe();
  if (me === null) {
    return null;
  }
  const items = adminNavItems(me.role).filter((item) => item.href !== '/admin');

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Quản trị</h1>
      <p className="text-sm text-muted">
        {me.email} · {me.role}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.href}>
            <Link href={item.href} className="font-serif text-xl">
              {item.label}
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
