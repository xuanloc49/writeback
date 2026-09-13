'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { formatDateTimeVi } from '../../../lib/format';
import { withQuery } from '../../../lib/query-string';
import { beginListRequest, commitListCursor, isLiveRequest } from '../../../lib/request-seq';
import type { AdminUserRow, Page } from '../../../lib/admin-types';
import { EmptyTableRow, inputClass } from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

export default function AdminUsersPage() {
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestSeq = useRef(0);
  const cursorGeneration = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const token = beginListRequest(requestSeq, cursor ? 'more' : 'fresh', cursorGeneration);
      if (token === null) {
        return;
      }
      if (!cursor) {
        setNextCursor(null);
      }
      try {
        const res = await api<Page<AdminUserRow>>(
          withQuery('/admin/users', { q: q.trim() || undefined, cursor }),
        );
        if (!commitListCursor(requestSeq, token, cursorGeneration)) {
          return;
        }
        setItems((current) => (cursor ? [...current, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (!isLiveRequest(requestSeq, token)) {
          return;
        }
        setError(formatAdminError(err, 'Không tải được user.'));
        setLoaded(true);
      }
    },
    [q],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Người dùng</h1>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setQ(qDraft.trim());
        }}
      >
        <input
          className={inputClass}
          placeholder="Tìm email"
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
        />
        <Button type="submit">Tìm</Button>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-busy={!loaded}>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1">
                Email
              </th>
              <th scope="col">Role</th>
              <th scope="col">Plan</th>
              <th scope="col">Tạo</th>
              <th scope="col">Login</th>
              <th scope="col">Card</th>
              <th scope="col">Viết 7 ngày</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <EmptyTableRow cols={7}>Đang tải…</EmptyTableRow>
            ) : items.length === 0 ? (
              <EmptyTableRow cols={7}>Không có user.</EmptyTableRow>
            ) : (
              items.map((user) => (
                <tr key={user.id}>
                  <td className="py-1">
                    <Link href={`/admin/users/${user.id}`}>{user.email}</Link>
                  </td>
                  <td>{user.role}</td>
                  <td>{user.plan}</td>
                  <td>{formatDateTimeVi(user.createdAt)}</td>
                  <td>{user.lastLoginAt ? formatDateTimeVi(user.lastLoginAt) : '—'}</td>
                  <td>{user.cardCount}</td>
                  <td>{user.rewriteNew7d}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {nextCursor ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void load(nextCursor).finally(() => setPending(false));
          }}
        >
          Tải thêm
        </Button>
      ) : null}
    </div>
  );
}
