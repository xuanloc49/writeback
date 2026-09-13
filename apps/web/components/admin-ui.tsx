import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ContentStatus } from '../lib/admin-types';
import { Button } from './ui';

export const inputClass = 'rounded-md border border-rule bg-card px-3 py-2 text-sm';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

export function StatusBadge({ status }: { status: ContentStatus }) {
  return (
    <span className={status === 'published' ? 'text-ok' : 'text-muted'}>
      {status === 'published' ? 'published' : 'draft'}
    </span>
  );
}

export function EmptyTableRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols} className="py-3 text-muted">
        {children}
      </td>
    </tr>
  );
}

export function ForbiddenNotice() {
  return (
    <section className="grid gap-2">
      <h1 className="font-serif text-2xl">Không có quyền</h1>
      <p>Tài khoản của bạn không được vào trang quản trị này.</p>
      <p>
        <Link href="/app">Về trang học</Link>
      </p>
    </section>
  );
}

export function ContentActions({
  status,
  pending,
  publishDisabled = false,
  onPublish,
  onUnpublish,
  onDelete,
}: {
  status: ContentStatus;
  pending: boolean;
  publishDisabled?: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'draft' ? (
        <Button type="button" disabled={pending || publishDisabled} onClick={onPublish}>
          Xuất bản
        </Button>
      ) : (
        <Button type="button" variant="ghost" disabled={pending} onClick={onUnpublish}>
          Gỡ xuất bản
        </Button>
      )}
      <Button type="button" variant="danger" disabled={pending} onClick={onDelete}>
        Xóa mềm
      </Button>
    </div>
  );
}
