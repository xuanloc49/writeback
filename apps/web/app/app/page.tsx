'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { DashboardResponse } from '../../lib/api-types';
import { Card, ErrorBanner } from '../../components/ui';
import { QuotaLine } from '../../components/quota-line';
import { useMe } from '../../components/learner-shell';

export default function DashboardPage() {
  const { me } = useMe();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void api<DashboardResponse>('/dashboard')
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Không tải được tổng quan.');
      });
  }, [me]);

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (data === null) {
    return <p>Đang tải tổng quan…</p>;
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Hôm nay</h1>
      <QuotaLine quota={data.quota} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Streak" value={`${data.streak} ngày`} />
        <Stat label="Due hôm nay" value={String(data.dueToday)} />
        <Stat label="Đã ôn" value={String(data.reviewedToday)} />
        <Stat label="Đã viết" value={String(data.rewriteNewToday)} />
      </div>
      {!data.hasCards ? (
        <Card>
          <p>Chưa có thẻ ôn. Hãy làm một bài viết lại — từ sẽ được thêm tự động.</p>
          <p className="mt-3">
            <Link href="/app/rewrite">Viết lại câu</Link>
          </p>
        </Card>
      ) : null}
      {data.cta === 'review' ? (
        <p>
          <Link href="/app/review">Ôn ngay</Link>
        </p>
      ) : null}
      {data.cta === 'rewrite' ? (
        <p>
          <Link href="/app/rewrite">Viết lại</Link>
        </p>
      ) : null}
      {data.topics.length > 0 ? (
        <Card>
          <h2 className="font-serif text-xl">Chủ đề</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {data.topics.map((topic) => (
              <li key={topic.topicId}>
                {topic.nameVi} · {topic.cardCount} thẻ · {topic.masteredPercent}% thuộc
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-xl">{value}</p>
    </Card>
  );
}
