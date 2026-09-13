'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '../../../components/learner-shell';
import { Button, Card, ErrorBanner } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import type { HistoryListResponse } from '../../../lib/api-types';
import { formatDateTimeVi } from '../../../lib/format';

export default function HistoryPage() {
  const { me } = useMe();
  const [data, setData] = useState<HistoryListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string): Promise<void> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await api<HistoryListResponse>(`/history${query}`);
    setData((current) =>
      current === null || !cursor
        ? res
        : { items: [...current.items, ...res.items], nextCursor: res.nextCursor },
    );
  }

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Không tải được lịch sử.');
    });
  }, [me]);

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (data === null) {
    return <p>Đang tải lịch sử…</p>;
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Lịch sử bài viết</h1>
      {data.items.length === 0 ? (
        <p>
          Chưa có bài. <Link href="/app/rewrite">Viết lại một câu</Link>.
        </p>
      ) : (
        <ul className="grid gap-2">
          {data.items.map((item) => (
            <li key={item.attemptId}>
              <Card>
                <Link href={`/app/rewrite/${item.attemptId}`}>{item.excerpt}</Link>
                <p className="score-aside mt-1">
                  {item.topicNameVi} · {formatDateTimeVi(item.scoredAt)} · {item.overallScore}/100
                  {item.hasRevision ? ' · đã sửa' : ''}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data.nextCursor ? (
        <Button variant="ghost" onClick={() => void load(data.nextCursor ?? undefined)}>
          Xem thêm
        </Button>
      ) : null}
    </div>
  );
}
