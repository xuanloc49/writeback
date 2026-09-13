'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ACCOUNT_DELETE_CONFIRMATION, ONBOARDING, type MeDto } from '@writeback/shared';
import { api, apiGetMe, ApiError } from '../lib/api';
import { googleSignOutUrl } from '../lib/auth-urls';
import { API_URL, APP_ORIGIN } from '../lib/config';
import { learnerRedirect } from '../lib/learner-gate';
import { Button, ErrorBanner } from './ui';

type MeState = {
  me: MeDto | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const MeContext = createContext<MeState | null>(null);

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (ctx === null) {
    throw new Error('useMe must be used under LearnerShell');
  }
  return ctx;
}

export function LearnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiGetMe();
      setMe(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiên đăng nhập.');
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (loading) {
      return;
    }
    const dest = learnerRedirect(me, pathname);
    if (dest !== null && dest !== pathname) {
      router.replace(dest);
    }
  }, [loading, me, pathname, router]);

  if (loading) {
    return <p className="px-4 py-8">Đang tải…</p>;
  }

  const showTos = me?.learningBlockedReason === 'TOS_REQUIRED';
  const learningOk = me !== null && !me.learningBlocked;

  return (
    <MeContext.Provider value={{ me, loading, refresh }}>
      <div className="min-h-dvh">
        {me?.impersonatorId ? <ImpersonateBanner email={me.email} onStopped={refresh} /> : null}
        <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 px-3 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={learningOk ? '/app' : '/app/account'}
              className="font-serif text-lg text-ink"
            >
              WriteBack
            </Link>
            {learningOk ? (
              <nav className="flex flex-wrap gap-x-3 text-sm">
                <Link href="/app">Tổng quan</Link>
                <Link href="/app/rewrite">Viết lại</Link>
                <Link href="/app/vocab">Từ vựng</Link>
                <Link href="/app/review">Ôn tập</Link>
                <Link href="/app/history">Lịch sử</Link>
                <Link href="/app/account">Tài khoản</Link>
              </nav>
            ) : me ? (
              <nav className="flex flex-wrap gap-x-3 text-sm">
                <Link href="/app/account">Tài khoản</Link>
                <Link href="/terms">Điều khoản</Link>
                <Link href="/privacy">Quyền riêng tư</Link>
              </nav>
            ) : null}
            {me ? (
              <a className="ml-auto text-sm" href={googleSignOutUrl(API_URL, APP_ORIGIN)}>
                Đăng xuất
              </a>
            ) : null}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6 pl-12">
          {loadError ? <ErrorBanner message={loadError} /> : null}
          {showTos ? <TosGate onAccepted={refresh} /> : children}
        </main>
      </div>
    </MeContext.Provider>
  );
}

function ImpersonateBanner({
  email,
  onStopped,
}: {
  email: string;
  onStopped: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  async function stop(): Promise<void> {
    try {
      await api('/admin/impersonate/stop', { method: 'POST', json: {} });
      await onStopped();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không dừng được impersonate.');
    }
  }
  return (
    <div className="bg-ink px-3 py-2 text-sm text-paper">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        <span>Đang xem với tư cách {email} —</span>
        <button type="button" className="underline" onClick={() => void stop()}>
          Dừng
        </button>
      </div>
      {error ? <p className="mx-auto max-w-3xl text-danger">{error}</p> : null}
    </div>
  );
}

function TosGate({ onAccepted }: { onAccepted: () => Promise<void> }) {
  const [age, setAge] = useState(false);
  const [tos, setTos] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const ready = age && tos && privacy;

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api('/me/tos', { method: 'POST', json: { accept: true, ageAttested: true } });
      await onAccepted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không chấp nhận được điều khoản.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4">
      <h1 className="font-serif text-2xl">Điều khoản trước khi học</h1>
      <p>
        Bạn cần đồng ý <Link href="/terms">Điều khoản</Link> và{' '}
        <Link href="/privacy">Quyền riêng tư</Link>, và xác nhận đủ 15 tuổi.
      </p>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
        Tôi đủ 15 tuổi.
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} />
        Tôi đồng ý Điều khoản.
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        Tôi đồng ý Quyền riêng tư.
      </label>
      {error ? <ErrorBanner message={error} /> : null}
      <Button disabled={!ready || pending} onClick={() => void submit()}>
        Tiếp tục
      </Button>
    </section>
  );
}

export function OnboardingForm({ me }: { me: MeDto }) {
  const [topics, setTopics] = useState<{ id: string; nameVi: string }[]>([]);
  const [selected, setSelected] = useState<string[]>(me.onboardingTopicIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { refresh } = useMe();

  useEffect(() => {
    void api<{ topics: { id: string; nameVi: string }[] }>('/topics')
      .then((res) => setTopics(res.topics))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Không tải được chủ đề.');
      });
  }, []);

  function toggle(id: string): void {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= ONBOARDING.MAX_TOPICS) {
        return current;
      }
      return [...current, id];
    });
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api('/me/onboarding', { method: 'PUT', json: { topicIds: selected } });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được chủ đề.');
    } finally {
      setPending(false);
    }
  }

  const valid =
    selected.length >= ONBOARDING.MIN_TOPICS && selected.length <= ONBOARDING.MAX_TOPICS;

  return (
    <section className="grid gap-3">
      <h2 className="font-serif text-xl">Chọn 1–3 chủ đề</h2>
      <p className="text-sm text-muted">Không bỏ qua được. Bạn đổi lại sau trên trang tài khoản.</p>
      <ul className="grid gap-2">
        {topics.map((topic) => (
          <li key={topic.id}>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={selected.includes(topic.id)}
                onChange={() => toggle(topic.id)}
              />
              {topic.nameVi}
            </label>
          </li>
        ))}
      </ul>
      {error ? <ErrorBanner message={error} /> : null}
      <Button disabled={!valid || pending} onClick={() => void submit()}>
        Lưu chủ đề
      </Button>
    </section>
  );
}

export function DeleteAccountForm() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api('/me', { method: 'DELETE', json: { confirm } });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không xóa được tài khoản.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-2">
      <h2 className="font-serif text-xl">Xóa tài khoản</h2>
      <p className="text-sm text-muted">
        Gõ đúng <code>{ACCOUNT_DELETE_CONFIRMATION}</code> để xóa cứng dữ liệu học của bạn.
      </p>
      <input
        className="rounded-md border border-rule bg-card px-3 py-2"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        aria-label="Xác nhận xóa"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        variant="danger"
        disabled={confirm !== ACCOUNT_DELETE_CONFIRMATION || pending}
        onClick={() => void submit()}
      >
        Xóa tài khoản
      </Button>
    </section>
  );
}
