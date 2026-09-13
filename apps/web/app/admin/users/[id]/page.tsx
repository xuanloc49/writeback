'use client';

import Link from 'next/link';
import { SUPPORT } from '@writeback/shared';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { formatAdminError } from '../../../../lib/admin-error';
import { formatDateTimeVi } from '../../../../lib/format';
import { isLiveRequest, listRequestToken } from '../../../../lib/request-seq';
import type { AdminTopic, AdminUserDetail } from '../../../../lib/admin-types';
import { Field, inputClass } from '../../../../components/admin-ui';
import { useMe } from '../../../../components/session';
import { Button, Card, ErrorBanner } from '../../../../components/ui';

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const { me, refresh } = useMe();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [topics, setTopics] = useState<AdminTopic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [plan, setPlan] = useState<'free' | 'premium'>('free');
  const [planNote, setPlanNote] = useState('');
  const [role, setRole] = useState<'user' | 'editor' | 'support' | 'admin'>('user');
  const [roleNote, setRoleNote] = useState('');
  const [allowTopicIds, setAllowTopicIds] = useState<string[]>([]);
  const [denyTopicIds, setDenyTopicIds] = useState<string[]>([]);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [extraRewriteNew, setExtraRewriteNew] = useState(0);
  const [extraRetry, setExtraRetry] = useState(0);
  const requestSeq = useRef(0);

  const isAdmin = me?.role === 'admin';

  useEffect(() => {
    const userId = params.id;
    if (!userId) {
      return;
    }
    const token = listRequestToken(requestSeq, 'fresh');
    setUser(null);
    setError(null);
    setPending(false);
    void api<AdminUserDetail>(`/admin/users/${userId}`)
      .then((detail) => {
        if (!isLiveRequest(requestSeq, token)) {
          return;
        }
        setUser(detail);
        setPlan(detail.plan);
        setRole(detail.role);
        setAllowTopicIds(detail.overrides.allowTopicIds);
        setDenyTopicIds(detail.overrides.denyTopicIds);
      })
      .catch((err: unknown) => {
        if (!isLiveRequest(requestSeq, token)) {
          return;
        }
        setError(formatAdminError(err, 'Không tải được user.'));
      });
  }, [params.id]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    void api<{ topics: AdminTopic[] }>('/admin/topics')
      .then((res) => {
        setTopics(res.topics);
        setCatalogError(null);
      })
      .catch((err: unknown) =>
        setCatalogError(formatAdminError(err, 'Không tải được chủ đề cho override.')),
      );
  }, [isAdmin]);

  if (user === null && error) {
    return (
      <div className="grid gap-3">
        <ErrorBanner message={error} />
        <p className="text-sm">
          <Link href="/admin/users">← Người dùng</Link>
        </p>
      </div>
    );
  }
  if (user === null) {
    return <p>Đang tải…</p>;
  }

  const userId = user.id;

  async function changePlan(): Promise<void> {
    const token = requestSeq.current;
    setPending(true);
    setError(null);
    try {
      await api(`/admin/users/${userId}/plan`, {
        method: 'POST',
        json: { plan, note: planNote },
      });
      const detail = await api<AdminUserDetail>(`/admin/users/${userId}`);
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setUser(detail);
      setPlan(detail.plan);
      setPlanNote('');
    } catch (err) {
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setError(formatAdminError(err, 'Không đổi được plan.'));
    } finally {
      if (isLiveRequest(requestSeq, token)) {
        setPending(false);
      }
    }
  }

  async function changeRole(): Promise<void> {
    const token = requestSeq.current;
    setPending(true);
    setError(null);
    try {
      await api(`/admin/users/${userId}/role`, {
        method: 'POST',
        json: { role, note: roleNote },
      });
      const detail = await api<AdminUserDetail>(`/admin/users/${userId}`);
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setUser(detail);
      setRole(detail.role);
      setRoleNote('');
      if (me?.id === userId) {
        await refresh();
      }
    } catch (err) {
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setError(formatAdminError(err, 'Không đổi được role.'));
    } finally {
      if (isLiveRequest(requestSeq, token)) {
        setPending(false);
      }
    }
  }

  async function saveOverrides(): Promise<void> {
    const token = requestSeq.current;
    setPending(true);
    setError(null);
    try {
      const overrides = await api<{ allowTopicIds: string[]; denyTopicIds: string[] }>(
        `/admin/users/${userId}/overrides`,
        { method: 'PUT', json: { allowTopicIds, denyTopicIds } },
      );
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setAllowTopicIds(overrides.allowTopicIds);
      setDenyTopicIds(overrides.denyTopicIds);
    } catch (err) {
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setError(formatAdminError(err, 'Không lưu được override.'));
    } finally {
      if (isLiveRequest(requestSeq, token)) {
        setPending(false);
      }
    }
  }

  async function impersonate(): Promise<void> {
    const token = requestSeq.current;
    setPending(true);
    setError(null);
    try {
      await api(`/admin/users/${userId}/impersonate`, {
        method: 'POST',
        json: { reason: impersonateReason },
      });
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      window.location.assign('/app');
    } catch (err) {
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setError(formatAdminError(err, 'Không impersonate được.'));
      setPending(false);
    }
  }

  async function grantQuota(): Promise<void> {
    const token = requestSeq.current;
    setPending(true);
    setError(null);
    try {
      await api(`/admin/users/${userId}/quota-grants`, {
        method: 'POST',
        json: { reason: grantReason, extraRewriteNew, extraRetry },
      });
      const detail = await api<AdminUserDetail>(`/admin/users/${userId}`);
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setUser(detail);
      setGrantReason('');
      setExtraRewriteNew(0);
      setExtraRetry(0);
    } catch (err) {
      if (!isLiveRequest(requestSeq, token)) {
        return;
      }
      setError(formatAdminError(err, 'Không cộng được lượt.'));
    } finally {
      if (isLiveRequest(requestSeq, token)) {
        setPending(false);
      }
    }
  }

  function setOverride(topicId: string, mode: 'none' | 'allow' | 'deny'): void {
    setAllowTopicIds((current) => current.filter((id) => id !== topicId));
    setDenyTopicIds((current) => current.filter((id) => id !== topicId));
    if (mode === 'allow') {
      setAllowTopicIds((current) => [...current, topicId]);
    }
    if (mode === 'deny') {
      setDenyTopicIds((current) => [...current, topicId]);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm">
        <Link href="/admin/users">← Người dùng</Link>
      </p>
      <h1 className="font-serif text-3xl">{user.email}</h1>
      <p className="text-sm text-muted">
        {user.role} · {user.plan} · {user.cardCount} thẻ · viết 7 ngày: {user.rewriteNew7d}
      </p>
      {error ? <ErrorBanner message={error} /> : null}
      {catalogError ? <ErrorBanner message={catalogError} /> : null}
      <Card className="grid gap-1 text-sm">
        <p>Tạo: {formatDateTimeVi(user.createdAt)}</p>
        <p>Login: {user.lastLoginAt ? formatDateTimeVi(user.lastLoginAt) : '—'}</p>
        <p>ToS: {user.tosAcceptedAt ? formatDateTimeVi(user.tosAcceptedAt) : 'chưa'}</p>
        <p>
          Onboarding: {user.onboardingTopicIds.length} topic
          {user.onboardingCompletedAt ? ` (${formatDateTimeVi(user.onboardingCompletedAt)})` : ''}
        </p>
        <p>
          Quota {user.quotaToday.date}: viết {user.quotaToday.rewriteNewLeft}/
          {user.quotaToday.limits.rewriteNewPerDay}, retry {user.quotaToday.retryLeft}/
          {user.quotaToday.limits.retryPerDay}
        </p>
      </Card>

      <Card className="grid gap-3">
        <h2 className="font-serif text-xl">Impersonate</h2>
        {user.role !== 'user' ? (
          <p className="text-sm text-muted">
            Chỉ impersonate tài khoản role=user. Không impersonate staff.
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void impersonate();
            }}
          >
            <Field label={`Lý do (≥ ${SUPPORT.IMPERSONATE_REASON_MIN_LENGTH} ký tự)`}>
              <input
                className={inputClass}
                value={impersonateReason}
                onChange={(e) => setImpersonateReason(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              disabled={
                pending || impersonateReason.trim().length < SUPPORT.IMPERSONATE_REASON_MIN_LENGTH
              }
            >
              Xem với tư cách user này
            </Button>
          </form>
        )}
      </Card>

      <Card className="grid gap-3">
        <h2 className="font-serif text-xl">Cộng lượt hôm nay</h2>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void grantQuota();
          }}
        >
          <Field label="Lý do">
            <input
              className={inputClass}
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
            />
          </Field>
          <Field label="Thêm bài mới">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={user.quotaToday.limits.rewriteNewPerDay}
              value={extraRewriteNew}
              onChange={(e) => setExtraRewriteNew(Number(e.target.value))}
            />
          </Field>
          <Field label="Thêm retry">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={user.quotaToday.limits.retryPerDay}
              value={extraRetry}
              onChange={(e) => setExtraRetry(Number(e.target.value))}
            />
          </Field>
          <Button
            type="submit"
            disabled={
              pending ||
              grantReason.trim().length === 0 ||
              (extraRewriteNew <= 0 && extraRetry <= 0)
            }
          >
            Cộng grant
          </Button>
        </form>
      </Card>

      {isAdmin ? (
        <>
          <Card className="grid gap-3">
            <h2 className="font-serif text-xl">Đổi plan</h2>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void changePlan();
              }}
            >
              <select
                className={inputClass}
                value={plan}
                onChange={(e) => setPlan(e.target.value as 'free' | 'premium')}
              >
                <option value="free">free</option>
                <option value="premium">premium</option>
              </select>
              <Field label="Ghi chú (≥ 3 ký tự)">
                <input
                  className={inputClass}
                  value={planNote}
                  onChange={(e) => setPlanNote(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={pending || planNote.trim().length < 3}>
                Lưu plan
              </Button>
            </form>
            {user.planHistory.length > 0 ? (
              <ul className="text-sm text-muted">
                {user.planHistory.map((row) => (
                  <li key={row.id}>
                    {row.fromPlan} → {row.toPlan} · {formatDateTimeVi(row.createdAt)} · {row.note}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card className="grid gap-3">
            <h2 className="font-serif text-xl">Đổi role</h2>
            {me?.id === user.id ? (
              <p className="text-sm text-muted">
                Đây là tài khoản đang đăng nhập. Đổi role sẽ mất quyền admin.
              </p>
            ) : null}
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void changeRole();
              }}
            >
              <select
                className={inputClass}
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="user">user</option>
                <option value="editor">editor</option>
                <option value="support">support</option>
                <option value="admin">admin</option>
              </select>
              <Field label="Ghi chú (≥ 3 ký tự)">
                <input
                  className={inputClass}
                  value={roleNote}
                  onChange={(e) => setRoleNote(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={pending || roleNote.trim().length < 3}>
                Lưu role
              </Button>
            </form>
          </Card>
          <Card className="grid gap-3">
            <h2 className="font-serif text-xl">Override chủ đề</h2>
            {topics.length === 0 ? (
              <p className="text-sm text-muted">
                Allow: {allowTopicIds.join(', ') || '—'} · Deny: {denyTopicIds.join(', ') || '—'}
              </p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {topics.map((topic) => {
                  const mode = allowTopicIds.includes(topic.id)
                    ? 'allow'
                    : denyTopicIds.includes(topic.id)
                      ? 'deny'
                      : 'none';
                  return (
                    <li key={topic.id} className="flex flex-wrap items-center gap-3">
                      <span className="min-w-40">{topic.nameVi}</span>
                      <label>
                        <input
                          type="radio"
                          name={`ov-${topic.id}`}
                          checked={mode === 'none'}
                          onChange={() => setOverride(topic.id, 'none')}
                        />{' '}
                        mặc định
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`ov-${topic.id}`}
                          checked={mode === 'allow'}
                          onChange={() => setOverride(topic.id, 'allow')}
                        />{' '}
                        allow
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`ov-${topic.id}`}
                          checked={mode === 'deny'}
                          onChange={() => setOverride(topic.id, 'deny')}
                        />{' '}
                        deny
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button disabled={pending} onClick={() => void saveOverrides()}>
              Lưu override
            </Button>
          </Card>
        </>
      ) : null}
    </div>
  );
}
