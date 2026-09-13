'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from '../../../../components/learner-shell';
import { Button, Card, ErrorBanner } from '../../../../components/ui';
import { api, ApiError } from '../../../../lib/api';
import type { VocabDetailResponse } from '../../../../lib/api-types';
import { formatDateTimeVi, srsStatusVi } from '../../../../lib/format';

export default function VocabDetailPage() {
  const { lemmaId } = useParams<{ lemmaId: string }>();
  const { me } = useMe();
  const [data, setData] = useState<VocabDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void api<VocabDetailResponse>(`/vocab/${lemmaId}`)
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Không tải được từ.');
      });
  }, [me, lemmaId]);

  async function hide(): Promise<void> {
    try {
      await api(`/vocab/${lemmaId}/hide`, { method: 'POST' });
      setHidden(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không gỡ được từ.');
    }
  }

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error) {
    return <ErrorBanner message={error} />;
  }
  if (data === null) {
    return <p>Đang tải từ…</p>;
  }
  if (hidden) {
    return (
      <p>
        Đã gỡ khỏi bộ ôn. <Link href="/app/vocab">Về danh sách</Link>
      </p>
    );
  }

  const lemma = data.lemma;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">{lemma.topicNameVi}</p>
      <h1 className="font-serif text-3xl">{lemma.headword}</h1>
      <p>
        {lemma.pos ? `${lemma.pos} · ` : null}
        {lemma.phonetic} — {lemma.senseVi}
      </p>
      {lemma.notesVi ? <p className="text-sm">{lemma.notesVi}</p> : null}
      <p className="text-sm text-muted">
        {srsStatusVi(data.srs.status)} · ôn tiếp {formatDateTimeVi(data.srs.nextReviewAt)}
      </p>
      <Card>
        <h2 className="font-serif text-xl">Câu</h2>
        <ul className="mt-2 grid gap-2">
          {data.sentences.map((sentence, index) => (
            <li key={index}>
              {sentence.text}
              {sentence.source === 'example' ? (
                <span className="text-sm text-muted"> · {sentence.label}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Link href="/app/review">Ôn thẻ này</Link>
        <Link href={`/app/rewrite?lemmaId=${lemma.lemmaId}`}>Viết lại với từ này</Link>
        <Button variant="ghost" onClick={() => void hide()}>
          Gỡ khỏi bộ ôn
        </Button>
      </div>
    </div>
  );
}
