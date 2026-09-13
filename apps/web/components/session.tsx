'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDto } from '@writeback/shared';
import { api, apiGetMe, ApiError } from '../lib/api';
import { Button, ErrorBanner } from './ui';

export type MeState = {
  me: MeDto | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
};

const MeContext = createContext<MeState | null>(null);

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (ctx === null) {
    throw new Error('useMe must be used under MeProvider');
  }
  return ctx;
}

export function MeProvider({ children }: { children: ReactNode }) {
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

  return (
    <MeContext.Provider value={{ me, loading, loadError, refresh }}>{children}</MeContext.Provider>
  );
}

export function ImpersonateBanner({
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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>Đang xem với tư cách {email} —</span>
        <button type="button" className="underline" onClick={() => void stop()}>
          Dừng
        </button>
      </div>
      {error ? <p className="mx-auto max-w-6xl text-danger">{error}</p> : null}
    </div>
  );
}

export function TosGate({ onAccepted }: { onAccepted: () => Promise<void> }) {
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
