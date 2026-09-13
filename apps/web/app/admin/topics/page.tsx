'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { withQuery } from '../../../lib/query-string';
import { isLiveRequest, listRequestToken } from '../../../lib/request-seq';
import type { AdminTopic, ContentStatus, TopicContextView } from '../../../lib/admin-types';
import {
  ContentActions,
  EmptyTableRow,
  Field,
  StatusBadge,
  inputClass,
} from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<AdminTopic[]>([]);
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminTopic | null>(null);
  const [slug, setSlug] = useState('');
  const [nameVi, setNameVi] = useState('');
  const [context, setContext] = useState<TopicContextView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestSeq = useRef(0);
  const contextSeq = useRef(0);

  const selectedId = selected?.id ?? null;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await api<{ topics: AdminTopic[] }>(
        withQuery('/admin/topics', { status: status || undefined, q: q.trim() || undefined }),
      );
      if (seq !== requestSeq.current) {
        return;
      }
      setTopics(res.topics);
      setLoaded(true);
      setError(null);
      setSelected((current) => {
        if (current === null) {
          return null;
        }
        return res.topics.find((topic) => topic.id === current.id) ?? current;
      });
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      setError(formatAdminError(err, 'Không tải được chủ đề.'));
      setLoaded(true);
    }
  }, [q, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId === null) {
      listRequestToken(contextSeq, 'fresh');
      setContext(null);
      setContextError(null);
      return;
    }
    const token = listRequestToken(contextSeq, 'fresh');
    setContext(null);
    setContextError(null);
    void api<TopicContextView>(`/admin/topics/${selectedId}/context`)
      .then((view) => {
        if (!isLiveRequest(contextSeq, token)) {
          return;
        }
        setContext(view);
        setContextError(null);
      })
      .catch((err: unknown) => {
        if (!isLiveRequest(contextSeq, token)) {
          return;
        }
        setContextError(formatAdminError(err, 'Không tải được ngữ cảnh chủ đề.'));
      });
  }, [selectedId]);

  function pick(topic: AdminTopic | null): void {
    setSelected(topic);
    setSlug(topic?.slug ?? '');
    setNameVi(topic?.nameVi ?? '');
    setError(null);
  }

  async function create(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const created = await api<AdminTopic>('/admin/topics', {
        method: 'POST',
        json: { slug, nameVi },
      });
      await load();
      pick(created);
    } catch (err) {
      setError(formatAdminError(err, 'Không tạo được chủ đề.'));
    } finally {
      setPending(false);
    }
  }

  async function save(): Promise<void> {
    if (selected === null) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const updated = await api<AdminTopic>(`/admin/topics/${selected.id}`, {
        method: 'PATCH',
        json: { slug, nameVi },
      });
      await load();
      pick(updated);
    } catch (err) {
      setError(formatAdminError(err, 'Không lưu được chủ đề.'));
    } finally {
      setPending(false);
    }
  }

  async function act(path: 'publish' | 'unpublish' | 'delete'): Promise<void> {
    if (selected === null) {
      return;
    }
    if (path === 'delete' && !window.confirm('Xóa mềm chủ đề này?')) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (path === 'delete') {
        await api(`/admin/topics/${selected.id}`, { method: 'DELETE' });
        pick(null);
      } else {
        const updated = await api<AdminTopic>(`/admin/topics/${selected.id}/${path}`, {
          method: 'POST',
          json: {},
        });
        pick(updated);
      }
      await load();
    } catch (err) {
      setError(formatAdminError(err, 'Không thực hiện được thao tác.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Chủ đề</h1>
      <div className="flex flex-wrap gap-2">
        <select
          className={inputClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as ContentStatus | '')}
        >
          <option value="">Mọi trạng thái</option>
          <option value="draft">draft</option>
          <option value="published">published</option>
        </select>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setQ(qDraft.trim());
          }}
        >
          <input
            className={inputClass}
            placeholder="Tìm slug / tên"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <Button type="submit">Tìm</Button>
        </form>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {contextError ? <ErrorBanner message={contextError} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-busy={!loaded}>
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-1">
                  Tên
                </th>
                <th scope="col">Slug</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <EmptyTableRow cols={3}>Đang tải…</EmptyTableRow>
              ) : topics.length === 0 ? (
                <EmptyTableRow cols={3}>Chưa có chủ đề.</EmptyTableRow>
              ) : (
                topics.map((topic) => (
                  <tr
                    key={topic.id}
                    tabIndex={0}
                    className={`cursor-pointer ${selectedId === topic.id ? 'bg-accent/10' : ''}`}
                    onClick={() => pick(topic)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(topic);
                      }
                    }}
                  >
                    <td className="py-1">{topic.nameVi}</td>
                    <td>{topic.slug}</td>
                    <td>
                      <StatusBadge status={topic.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
        <Card className="grid gap-3">
          <h2 className="font-serif text-xl">{selected ? 'Sửa' : 'Tạo mới'}</h2>
          {selected && topics.every((topic) => topic.id !== selected.id) ? (
            <p className="text-sm text-muted">Mục đang sửa không có trong danh sách lọc.</p>
          ) : null}
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (selected) {
                void save();
              } else {
                void create();
              }
            }}
          >
            <Field label="Slug">
              <input
                className={inputClass}
                value={slug}
                placeholder="kebab-case"
                onChange={(e) => setSlug(e.target.value)}
              />
            </Field>
            <Field label="Tên tiếng Việt">
              <input
                className={inputClass}
                value={nameVi}
                onChange={(e) => setNameVi(e.target.value)}
              />
            </Field>
            {selected ? (
              <Button type="submit" disabled={pending}>
                Lưu
              </Button>
            ) : (
              <Button type="submit" disabled={pending || slug.length === 0 || nameVi.length === 0}>
                Tạo nháp
              </Button>
            )}
          </form>
          {selected ? (
            <ContentActions
              status={selected.status}
              pending={pending}
              onPublish={() => void act('publish')}
              onUnpublish={() => void act('unpublish')}
              onDelete={() => void act('delete')}
            />
          ) : null}
          <Button type="button" variant="ghost" onClick={() => pick(null)}>
            Bỏ chọn
          </Button>
          {context ? (
            <div className="text-sm">
              <p>
                Lemma {context.lemmaCounts.published} published / {context.lemmaCounts.draft} draft
              </p>
              <p>
                Prompt {context.promptCounts.published} published / {context.promptCounts.draft}{' '}
                draft
              </p>
              {context.blockers.length > 0 ? (
                <ul className="mt-2 list-disc pl-4 text-danger">
                  {context.blockers.map((blocker) => (
                    <li key={blocker.lemmaId}>
                      {blocker.headword}: {blocker.publishedPromptCount} prompt published (cần ≥ 2)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ok">Không có blocker ngữ cảnh.</p>
              )}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
