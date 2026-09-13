'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { formatDateTimeVi } from '../../../lib/format';
import type { AllowlistView } from '../../../lib/admin-types';
import { EmptyTableRow, Field, inputClass } from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

export default function AdminAllowlistPage() {
  const [data, setData] = useState<AllowlistView | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setData(await api<AllowlistView>('/admin/allowlist'));
    setLoaded(true);
    setError(null);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(formatAdminError(err, 'Không tải được allowlist.'));
      setLoaded(true);
    });
  }, [load]);

  async function add(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api('/admin/allowlist', { method: 'POST', json: { email } });
      setEmail('');
      await load();
    } catch (err) {
      setError(formatAdminError(err, 'Không thêm được email.'));
    } finally {
      setPending(false);
    }
  }

  async function remove(value: string): Promise<void> {
    if (!window.confirm(`Xóa ${value} khỏi allowlist?`)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api(`/admin/allowlist/${encodeURIComponent(value)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(formatAdminError(err, 'Không xóa được email.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Allowlist beta</h1>
      {data ? (
        <p className="text-sm text-muted">
          Cờ <code>BETA_ALLOWLIST_ENABLED</code> đang {data.enabled ? 'bật' : 'tắt'} (chỉ đọc từ
          env, không đổi trên UI).
        </p>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="grid gap-3">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field label="Thêm email">
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={pending || email.trim().length === 0}>
            Thêm
          </Button>
        </form>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-busy={!loaded}>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1">
                Email
              </th>
              <th scope="col">Thêm lúc</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <EmptyTableRow cols={3}>Đang tải…</EmptyTableRow>
            ) : (data?.emails ?? []).length === 0 ? (
              <EmptyTableRow cols={3}>Chưa có email.</EmptyTableRow>
            ) : (
              (data?.emails ?? []).map((row) => (
                <tr key={row.email}>
                  <td className="py-1">{row.email}</td>
                  <td>{formatDateTimeVi(row.createdAt)}</td>
                  <td>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending}
                      onClick={() => void remove(row.email)}
                    >
                      Xóa
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
