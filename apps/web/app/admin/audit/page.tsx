'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { formatDateTimeVi } from '../../../lib/format';
import { withQuery } from '../../../lib/query-string';
import { beginListRequest, commitListCursor, isLiveRequest } from '../../../lib/request-seq';
import type { AuditRowView, Page } from '../../../lib/admin-types';
import { EmptyTableRow, inputClass } from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

export default function AdminAuditPage() {
  const [actionDraft, setActionDraft] = useState('');
  const [action, setAction] = useState('');
  const [items, setItems] = useState<AuditRowView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestSeq = useRef(0);
  const cursorGeneration = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const token = beginListRequest(requestSeq, cursor ? 'more' : 'fresh', cursorGeneration);
      if (token === null) {
        return;
      }
      if (!cursor) {
        setNextCursor(null);
      }
      try {
        const res = await api<Page<AuditRowView>>(
          withQuery('/admin/audit', { action: action.trim() || undefined, cursor }),
        );
        if (!commitListCursor(requestSeq, token, cursorGeneration)) {
          return;
        }
        setItems((current) => (cursor ? [...current, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (!isLiveRequest(requestSeq, token)) {
          return;
        }
        setError(formatAdminError(err, 'Không tải được audit.'));
        setLoaded(true);
      }
    },
    [action],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Audit</h1>
      <p className="text-sm text-muted">
        Admin thấy mọi hàng. Support chỉ thấy action của mình. Payload không hiện câu viết của học
        viên.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setAction(actionDraft.trim());
        }}
      >
        <input
          className={inputClass}
          placeholder="Lọc action (ví dụ content.publish)"
          value={actionDraft}
          onChange={(e) => setActionDraft(e.target.value)}
        />
        <Button type="submit">Lọc</Button>
      </form>
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-busy={!loaded}>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1">
                Thời điểm
              </th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Actor</th>
              <th scope="col">Request</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <EmptyTableRow cols={5}>Đang tải…</EmptyTableRow>
            ) : items.length === 0 ? (
              <EmptyTableRow cols={5}>Chưa có bản ghi audit.</EmptyTableRow>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  <td className="py-1 whitespace-nowrap">{formatDateTimeVi(row.createdAt)}</td>
                  <td>{row.action}</td>
                  <td>
                    {row.targetType}
                    {row.targetId ? ` ${row.targetId.slice(0, 8)}` : ''}
                  </td>
                  <td>{row.actorId ? row.actorId.slice(0, 8) : '—'}</td>
                  <td>{row.requestId ? row.requestId.slice(0, 8) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {nextCursor ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void load(nextCursor).finally(() => setPending(false));
          }}
        >
          Tải thêm
        </Button>
      ) : null}
    </div>
  );
}
