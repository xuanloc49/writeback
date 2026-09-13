'use client';

import { CONTENT } from '@writeback/shared';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { withQuery } from '../../../lib/query-string';
import type {
  CommitResponse,
  DryRunResponse,
  ImportIssue,
  PublishAllResponse,
} from '../../../lib/admin-types';
import { Field, inputClass } from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

export default function AdminImportPage() {
  const [filename, setFilename] = useState('upload.json');
  const [raw, setRaw] = useState('');
  const [dryRun, setDryRun] = useState<DryRunResponse | null>(null);
  const [commit, setCommit] = useState<CommitResponse | null>(null);
  const [publish, setPublish] = useState<PublishAllResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function parseDocument(): unknown {
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length > CONTENT.IMPORT_MAX_BYTES) {
      throw new Error(`File vượt ${CONTENT.IMPORT_MAX_BYTES} bytes.`);
    }
    return JSON.parse(raw) as unknown;
  }

  async function runDryRun(): Promise<void> {
    setPending(true);
    setError(null);
    setCommit(null);
    setPublish(null);
    try {
      const document = parseDocument();
      const res = await api<DryRunResponse>(withQuery('/admin/import/dry-run', { filename }), {
        method: 'POST',
        json: document,
      });
      setDryRun(res);
    } catch (err) {
      setDryRun(null);
      setError(formatAdminError(err, err instanceof Error ? err.message : 'Dry-run thất bại.'));
    } finally {
      setPending(false);
    }
  }

  async function runCommit(): Promise<void> {
    if (dryRun === null || !dryRun.ok) {
      return;
    }
    setPending(true);
    setError(null);
    setPublish(null);
    try {
      const res = await api<CommitResponse>('/admin/import/commit', {
        method: 'POST',
        json: { batchId: dryRun.batchId },
      });
      setCommit(res);
    } catch (err) {
      setError(formatAdminError(err, 'Commit thất bại.'));
    } finally {
      setPending(false);
    }
  }

  async function runPublishAll(): Promise<void> {
    const batchId = commit?.batchId ?? dryRun?.batchId;
    if (!batchId) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await api<PublishAllResponse>(`/admin/import/${batchId}/publish-all`, {
        method: 'POST',
        json: {},
      });
      setPublish(res);
    } catch (err) {
      setError(formatAdminError(err, 'Publish all thất bại.'));
    } finally {
      setPending(false);
    }
  }

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    setFilename(file.name);
    setRaw(await file.text());
    setDryRun(null);
    setCommit(null);
    setPublish(null);
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Import JSON</h1>
      <p className="text-sm text-muted">
        Schema v{CONTENT.IMPORT_SCHEMA_VERSION}, tối đa {CONTENT.IMPORT_MAX_BYTES / (1024 * 1024)}{' '}
        MB. Dry-run không ghi nội dung. Commit luôn ra draft. Publish all sau khi duyệt. Sửa JSON
        hoặc tên file sẽ hủy kết quả dry-run.
      </p>
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="grid gap-3">
        <Field label="File JSON">
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </Field>
        <Field label="Tên file (ghi batch)">
          <input
            className={inputClass}
            value={filename}
            onChange={(e) => {
              setFilename(e.target.value);
              setDryRun(null);
              setCommit(null);
              setPublish(null);
            }}
          />
        </Field>
        <textarea
          className={`${inputClass} min-h-48 font-mono text-xs`}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setDryRun(null);
            setCommit(null);
            setPublish(null);
          }}
          placeholder='{"schema_version":1,"topics":[],"lemmas":[],"prompts":[]}'
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending || raw.trim().length === 0}
            onClick={() => void runDryRun()}
          >
            Dry-run
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || dryRun === null || !dryRun.ok}
            onClick={() => void runCommit()}
          >
            Commit draft
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || commit === null}
            onClick={() => void runPublishAll()}
          >
            Publish all từ batch
          </Button>
        </div>
      </Card>
      {dryRun ? <Report title="Dry-run" report={dryRun} /> : null}
      {commit ? <Report title={`Commit ${commit.committedAt}`} report={commit} /> : null}
      {publish ? (
        <Card className="grid gap-2 text-sm">
          <h2 className="font-serif text-xl">Publish all</h2>
          <p>Đã xuất bản: {publish.published.length}</p>
          {publish.failed.length > 0 ? (
            <ul className="list-disc pl-4 text-danger">
              {publish.failed.map((item) => (
                <li key={`${item.type}-${item.id}`}>
                  {item.type} {item.id.slice(0, 8)}: {item.reasons.join(', ')}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ok">Không có item thất bại.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Report({
  title,
  report,
}: {
  title: string;
  report: {
    batchId?: string;
    ok?: boolean;
    errors: ImportIssue[];
    warnings: ImportIssue[];
    counts: DryRunResponse['counts'];
  };
}) {
  return (
    <Card className="grid gap-2 text-sm">
      <h2 className="font-serif text-xl">{title}</h2>
      {report.batchId ? <p className="text-muted">batch {report.batchId}</p> : null}
      {'ok' in report ? (
        <p>{report.ok ? 'OK — có thể commit' : 'Có lỗi, không commit được'}</p>
      ) : null}
      <p>
        Topics +{report.counts.topics.create}/{report.counts.topics.update} · Lemmas +
        {report.counts.lemmas.create}/{report.counts.lemmas.update} · Prompts +
        {report.counts.prompts.create}/{report.counts.prompts.update}
      </p>
      <IssueList label="Lỗi" items={report.errors} />
      <IssueList label="Cảnh báo" items={report.warnings} />
    </Card>
  );
}

function IssueList({ label, items }: { label: string; items: ImportIssue[] }) {
  if (items.length === 0) {
    return <p>{label}: không.</p>;
  }
  return (
    <div>
      <p>
        {label} ({items.length})
      </p>
      <ul className="list-disc pl-4">
        {items.map((item, index) => (
          <li key={`${item.code}-${index}`}>
            [{item.type} {item.index ?? 'doc'} {item.key ?? ''} {item.field ?? ''}] {item.code}:{' '}
            {item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
