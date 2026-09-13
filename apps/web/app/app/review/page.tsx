'use client';

import { useEffect, useState } from 'react';
import { useMe } from '../../../components/learner-shell';
import { Button, Card, ErrorBanner } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import type {
  CardView,
  GradeResponse,
  NextResponse,
  StartSessionResponse,
} from '../../../lib/api-types';

export default function ReviewPage() {
  const { me } = useMe();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [next, setNext] = useState<NextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<GradeResponse['reveal'] | undefined>();
  const [correct, setCorrect] = useState<boolean | undefined>();
  const [pendingNext, setPendingNext] = useState<NextResponse | null>(null);

  async function start(): Promise<void> {
    const session = await api<StartSessionResponse>('/review/sessions', { method: 'POST' });
    setSessionId(session.sessionId);
    const nxt = await api<NextResponse>(`/review/sessions/${session.sessionId}/next`);
    setNext(nxt);
    setReveal(undefined);
    setCorrect(undefined);
  }

  useEffect(() => {
    if (!me || me.learningBlocked) {
      return;
    }
    void start().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Không bắt đầu được phiên ôn.');
    });
  }, [me]);

  async function grade(body: Record<string, unknown>): Promise<void> {
    if (sessionId === null) {
      return;
    }
    setError(null);
    try {
      const res = await api<GradeResponse>(`/review/sessions/${sessionId}/grade`, {
        method: 'POST',
        json: body,
      });
      if (res.correct === false) {
        setReveal(res.reveal);
        setCorrect(false);
        setPendingNext(res.next);
      } else {
        setReveal(undefined);
        setCorrect(undefined);
        setPendingNext(null);
        setNext(res.next);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không chấm được thẻ.');
    }
  }

  if (!me || me.learningBlocked) {
    return null;
  }
  if (error && next === null) {
    return <ErrorBanner message={error} />;
  }
  if (next === null) {
    return <p>Đang tải phiên ôn…</p>;
  }
  if (next.done) {
    return (
      <div className="grid gap-3">
        <h1 className="font-serif text-3xl">Hết phiên</h1>
        <p>{next.reason === 'cap' ? 'Đã đủ số thẻ của phiên này.' : 'Không còn thẻ đến hạn.'}</p>
        <Button onClick={() => void start()}>Mở phiên mới</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Ôn tập</h1>
      <p className="text-sm text-muted">Còn {next.remaining} thẻ trong phiên</p>
      {error ? <ErrorBanner message={error} /> : null}
      {correct === false ? null : (
        <ReviewCard card={next.card} onGrade={(body) => void grade(body)} />
      )}
      {correct === false && reveal ? (
        <Card>
          <p>
            Đáp án: <strong>{reveal.headword}</strong>
          </p>
          {reveal.exampleSentence ? (
            <p className="font-serif mt-1">{reveal.exampleSentence}</p>
          ) : null}
          <Button
            className="mt-3"
            onClick={() => {
              if (pendingNext !== null) {
                setNext(pendingNext);
              }
              setReveal(undefined);
              setCorrect(undefined);
              setPendingNext(null);
            }}
          >
            Thẻ tiếp
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function ReviewCard({
  card,
  onGrade,
}: {
  card: CardView;
  onGrade: (body: Record<string, unknown>) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    setFlipped(false);
    setAnswer('');
  }, [card.cardId]);

  if (card.mode === 'flashcard') {
    return (
      <Card>
        <p className="text-sm text-muted">{card.front.topicNameVi}</p>
        <p className="font-serif text-2xl">{card.front.senseVi}</p>
        {flipped ? (
          <div className="mt-3 grid gap-2">
            <p className="text-2xl">{card.back.headword}</p>
            <p className="text-sm text-muted">{card.back.phonetic}</p>
            {card.back.notesVi ? <p>{card.back.notesVi}</p> : null}
            {card.back.exampleSentence ? (
              <p className="font-serif">{card.back.exampleSentence}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => onGrade({ cardId: card.cardId, quality: 1 })}>
                Quên
              </Button>
              <Button variant="ghost" onClick={() => onGrade({ cardId: card.cardId, quality: 3 })}>
                Khó
              </Button>
              <Button variant="ghost" onClick={() => onGrade({ cardId: card.cardId, quality: 4 })}>
                Tốt
              </Button>
              <Button onClick={() => onGrade({ cardId: card.cardId, quality: 5 })}>Dễ</Button>
            </div>
          </div>
        ) : (
          <Button className="mt-4" onClick={() => setFlipped(true)}>
            Lật thẻ
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card>
      {card.mode === 'cloze' ? <p className="font-serif text-xl">{card.front.sentence}</p> : null}
      <p className="text-muted">{card.front.senseVi}</p>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onGrade({ cardId: card.cardId, answer });
        }}
      >
        <input
          className="w-full rounded-md border border-rule bg-paper px-3 py-2"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          aria-label="Đáp án"
        />
        <Button type="submit">Kiểm tra</Button>
      </form>
    </Card>
  );
}
