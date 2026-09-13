'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '../../../components/learner-shell';
import { Button, Card, ErrorBanner } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import type { VocabListResponse } from '../../../lib/api-types';
import { srsStatusVi } from '../../../lib/format';

export default function VocabPage() {
  const { me } = useMe();
  const [data, setData] = useState<VocabListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const res = await api<VocabListResponse>('/vocab');
    setData(res);
  }

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Không tải được từ vựng.');
    });
  }, [me]);

  async function unhide(lemmaId: string): Promise<void> {
    try {
      await api(`/vocab/${lemmaId}/unhide`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lấy lại được từ.');
    }
  }

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (data === null) {
    return <p>Đang tải từ vựng…</p>;
  }

  const empty = data.topics.every((topic) => topic.cards.length === 0);

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Từ vựng của tôi</h1>
      {empty ? (
        <p>
          Chưa có thẻ. <Link href="/app/rewrite">Làm một bài viết lại</Link> để tự thêm từ.
        </p>
      ) : null}
      {data.topics.map((topic) =>
        topic.cards.length === 0 ? null : (
          <Card key={topic.topicId}>
            <h2 className="font-serif text-xl">{topic.nameVi}</h2>
            <ul className="mt-2 grid gap-2">
              {topic.cards.map((card) => (
                <li key={card.cardId}>
                  <Link href={`/app/vocab/${card.lemmaId}`}>{card.headword}</Link>
                  <span className="text-sm text-muted">
                    {' '}
                    — {card.senseVi} · {srsStatusVi(card.status)}
                    {card.dueToday ? ' · due hôm nay' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ),
      )}
      {data.hidden.length > 0 ? (
        <Card>
          <h2 className="font-serif text-xl">Đã gỡ</h2>
          <ul className="mt-2 grid gap-2">
            {data.hidden.map((card) => (
              <li key={card.cardId} className="flex flex-wrap items-center gap-2">
                <span>
                  {card.headword} · {card.topicNameVi}
                </span>
                <Button variant="ghost" onClick={() => void unhide(card.lemmaId)}>
                  Lấy lại
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
