'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useMe } from '../../../components/learner-shell';
import { Button, ErrorBanner } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import type { StartRewriteResponse, VisibleTopicList } from '../../../lib/api-types';

function RewriteStartForm() {
  const router = useRouter();
  const search = useSearchParams();
  const lemmaId = search.get('lemmaId') ?? undefined;
  const { me } = useMe();
  const [topics, setTopics] = useState<{ id: string; nameVi: string }[]>([]);
  const [topicId, setTopicId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void api<VisibleTopicList>('/topics')
      .then((res) => setTopics(res.topics))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Không tải được chủ đề.');
      });
  }, [me]);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const body: { topicId?: string; lemmaId?: string } = {};
      if (topicId) {
        body.topicId = topicId;
      }
      if (lemmaId) {
        body.lemmaId = lemmaId;
      }
      const res = await api<StartRewriteResponse>('/rewrite/start', { method: 'POST', json: body });
      router.push(`/app/rewrite/${res.attemptId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không bắt đầu được bài.');
    } finally {
      setPending(false);
    }
  }

  if (!me || me.learningBlocked) {
    return null;
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Viết lại câu</h1>
      <p className="text-muted">
        Hệ thống chọn mẫu tiếng Việt. Bạn viết lại bằng tiếng Anh, bắt buộc dùng các từ đích.
      </p>
      <label className="grid gap-1 text-sm">
        Chủ đề (không bắt buộc)
        <select
          className="rounded-md border border-rule bg-card px-3 py-2"
          value={topicId}
          onChange={(e) => setTopicId(e.target.value)}
        >
          <option value="">Hệ thống chọn</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.nameVi}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <div className="grid gap-2">
          <ErrorBanner message={error} />
          {error.includes('hết lượt') || error.includes('hết') ? (
            <p>
              <Link href="/app/review">Ôn tập trong lúc chờ lượt mới</Link>
            </p>
          ) : null}
        </div>
      ) : null}
      <Button disabled={pending} onClick={() => void start()}>
        Bắt đầu bài
      </Button>
    </div>
  );
}

export default function RewritePage() {
  return (
    <Suspense fallback={<p>Đang tải…</p>}>
      <RewriteStartForm />
    </Suspense>
  );
}
