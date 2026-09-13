'use client';

import { REWRITE } from '@writeback/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FeedbackPanel } from '../../../../components/feedback-panel';
import { useMe } from '../../../../components/learner-shell';
import { QuotaLine } from '../../../../components/quota-line';
import { Button, Card, ErrorBanner } from '../../../../components/ui';
import { api, ApiError } from '../../../../lib/api';
import type {
  AttemptFamilyResponse,
  CardAddedView,
  SubmitRewriteResponse,
} from '../../../../lib/api-types';
import { revisionWindowOpen } from '../../../../lib/rewrite-display';

const UNDO_MS = 10_000;

export default function AttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const { me } = useMe();
  const [family, setFamily] = useState<AttemptFamilyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userEn, setUserEn] = useState('');
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<CardAddedView[] | null>(null);
  const [deferred, setDeferred] = useState<string[]>([]);
  const [unpublished, setUnpublished] = useState(false);

  const load = useCallback(async () => {
    const data = await api<AttemptFamilyResponse>(`/rewrite/${attemptId}`);
    setFamily(data);
    const rev1 = data.revisions.find((row) => row.revision === 1);
    const rev2 = data.revisions.find((row) => row.revision === 2);
    if (rev1?.status !== 'scored') {
      setUserEn('');
    } else if (rev2 === undefined || rev2.status !== 'scored') {
      setUserEn(rev1.userEn ?? '');
    }
  }, [attemptId]);

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Không tải được bài.');
    });
  }, [me, load]);

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const id = window.setTimeout(() => setToast(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function submit(revision: 1 | 2): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const res = await api<SubmitRewriteResponse>(`/rewrite/${attemptId}/submit`, {
        method: 'POST',
        json: { revision, userEn },
      });
      setToast(res.cardsAdded.filter((card) => card.undoable));
      setDeferred(res.cardsDeferredCap20.map((card) => card.headword));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNPUBLISHED') {
        setUnpublished(true);
      }
      setError(err instanceof ApiError ? err.message : 'Không nộp được bài.');
    } finally {
      setPending(false);
    }
  }

  async function undo(cardId: string): Promise<void> {
    try {
      await api(`/vocab/cards/${cardId}/undo-auto-add`, { method: 'POST' });
      setToast((current) => current?.filter((card) => card.cardId !== cardId) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không hoàn tác được.');
    }
  }

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error && family === null) {
    return <ErrorBanner message={error} />;
  }
  if (family === null) {
    return <p>Đang tải bài…</p>;
  }

  const rev1 = family.revisions.find((row) => row.revision === 1);
  const rev2 = family.revisions.find((row) => row.revision === 2);
  const rev1Scored = rev1?.status === 'scored';
  const rev2Scored = rev2?.status === 'scored';
  const canRevise = revisionWindowOpen(family.revisionAvailable, family.revisionUntil, new Date());
  const writingRevision: 1 | 2 = rev1Scored ? 2 : 1;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">{family.prompt.topicNameVi}</p>
      <h1 className="font-serif text-2xl">{family.prompt.textVi}</h1>
      {family.prompt.hintsVi ? <p className="text-sm text-muted">{family.prompt.hintsVi}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {family.prompt.targets.map((target) => (
          <li key={target.lemmaId} className="rounded-full border border-rule px-3 py-1 text-sm">
            <strong>{target.headword}</strong>
            <span className="text-muted"> — {target.senseVi}</span>
          </li>
        ))}
      </ul>
      <QuotaLine quota={family.quota} />

      {unpublished ? (
        <Card>
          <p>Bài này không còn khả dụng.</p>
          <p className="mt-2">
            <Link href="/app/rewrite">Lấy bài khác</Link>
          </p>
        </Card>
      ) : null}

      {!rev1Scored && !unpublished ? (
        <WriteForm
          userEn={userEn}
          setUserEn={setUserEn}
          pending={pending}
          onSubmit={() => void submit(1)}
        />
      ) : null}

      {rev1Scored && rev1 ? (
        <Card>
          <h2 className="font-serif text-xl">Lần 1</h2>
          <FeedbackPanel
            ideaMatch={rev1.ideaMatch}
            usedRequiredWords={rev1.usedRequiredWords}
            displayIssues={rev1.displayIssues}
            naturalnessNoteVi={rev1.naturalnessNoteVi}
            encouragementVi={rev1.encouragementVi}
            overallScore={rev1.overallScore}
            modelRewriteEn={rev1.modelRewriteEn}
            userEn={rev1.userEn}
            showModelRewrite
          />
        </Card>
      ) : null}

      {rev1Scored && canRevise && !rev2Scored && !unpublished ? (
        <Card>
          <h2 className="font-serif text-xl">Viết lại bài này</h2>
          <p className="text-sm text-muted">Không trừ lượt bài mới. Còn cửa sổ 15 phút.</p>
          {family.showModelRewriteToggle && rev1?.modelRewriteEn ? (
            <FeedbackPanel
              ideaMatch={null}
              usedRequiredWords={[]}
              displayIssues={[]}
              naturalnessNoteVi={null}
              encouragementVi={null}
              overallScore={null}
              modelRewriteEn={rev1.modelRewriteEn}
              showModelRewrite
              modelRewriteCollapsed
            />
          ) : null}
          <WriteForm
            userEn={userEn}
            setUserEn={setUserEn}
            pending={pending}
            onSubmit={() => void submit(writingRevision)}
          />
        </Card>
      ) : null}

      {rev2Scored && rev2 ? (
        <Card>
          <h2 className="font-serif text-xl">Lần 2</h2>
          <FeedbackPanel
            ideaMatch={rev2.ideaMatch}
            usedRequiredWords={rev2.usedRequiredWords}
            displayIssues={rev2.displayIssues}
            naturalnessNoteVi={rev2.naturalnessNoteVi}
            encouragementVi={rev2.encouragementVi}
            overallScore={rev2.overallScore}
            modelRewriteEn={rev2.modelRewriteEn}
            userEn={rev2.userEn}
            showModelRewrite
          />
        </Card>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {deferred.length > 0 ? (
        <p className="text-sm text-muted">Đã đạt hạn từ mới hôm nay: {deferred.join(', ')}</p>
      ) : null}
      {toast && toast.length > 0 ? (
        <div className="rounded-md border border-rule bg-card px-3 py-2 text-sm">
          Đã thêm {toast.map((card) => card.headword).join(', ')}.{' '}
          {toast.map((card) => (
            <button
              key={card.cardId}
              className="underline"
              type="button"
              onClick={() => void undo(card.cardId)}
            >
              Hoàn tác {card.headword}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WriteForm({
  userEn,
  setUserEn,
  pending,
  onSubmit,
}: {
  userEn: string;
  setUserEn: (value: string) => void;
  pending: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="text-sm" htmlFor="userEn">
        Câu tiếng Anh
      </label>
      <textarea
        id="userEn"
        className="min-h-28 w-full rounded-md border border-rule bg-card px-3 py-2"
        maxLength={REWRITE.USER_EN_MAX_LENGTH}
        value={userEn}
        onChange={(e) => setUserEn(e.target.value)}
        required
      />
      <p className="text-xs text-muted">
        {userEn.length}/{REWRITE.USER_EN_MAX_LENGTH}
      </p>
      <Button type="submit" disabled={pending || userEn.trim().length === 0}>
        Nộp bài
      </Button>
    </form>
  );
}
