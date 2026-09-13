'use client';

import { CONTENT } from '@writeback/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { promptPublishMessages } from '../../../lib/admin-publish';
import { withQuery } from '../../../lib/query-string';
import { isLiveRequest, listRequestToken } from '../../../lib/request-seq';
import type { AdminLemma, AdminPrompt, AdminTopic, ContentStatus } from '../../../lib/admin-types';
import {
  ContentActions,
  EmptyTableRow,
  Field,
  StatusBadge,
  inputClass,
} from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

const EMPTY = {
  externalKey: '',
  textVi: '',
  topicId: '',
  sampleEn: '',
  hintsVi: '',
  targetLemmaIds: [] as string[],
};

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<AdminPrompt[]>([]);
  const [topics, setTopics] = useState<AdminTopic[]>([]);
  const [lemmas, setLemmas] = useState<AdminLemma[]>([]);
  const [topicId, setTopicId] = useState('');
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AdminPrompt | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestSeq = useRef(0);
  const lemmaSeq = useRef(0);

  const selectedId = selected?.id ?? null;
  const lemmaTopicId = form.topicId;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await api<{ prompts: AdminPrompt[] }>(
        withQuery('/admin/prompts', {
          topicId: topicId || undefined,
          status: status || undefined,
          q: q.trim() || undefined,
        }),
      );
      if (seq !== requestSeq.current) {
        return;
      }
      setPrompts(res.prompts);
      setLoaded(true);
      setError(null);
      setSelected((current) => {
        if (current === null) {
          return null;
        }
        return res.prompts.find((prompt) => prompt.id === current.id) ?? current;
      });
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      setError(formatAdminError(err, 'Không tải được câu.'));
      setLoaded(true);
    }
  }, [q, status, topicId]);

  useEffect(() => {
    void api<{ topics: AdminTopic[] }>('/admin/topics')
      .then((res) => {
        setTopics(res.topics);
        setCatalogError(null);
      })
      .catch((err: unknown) => setCatalogError(formatAdminError(err, 'Không tải được chủ đề.')));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!lemmaTopicId) {
      listRequestToken(lemmaSeq, 'fresh');
      setLemmas([]);
      setTargetsError(null);
      return;
    }
    const token = listRequestToken(lemmaSeq, 'fresh');
    setLemmas([]);
    setTargetsError(null);
    void api<{ lemmas: AdminLemma[] }>(withQuery('/admin/lemmas', { topicId: lemmaTopicId }))
      .then((res) => {
        if (!isLiveRequest(lemmaSeq, token)) {
          return;
        }
        setLemmas(res.lemmas);
        setTargetsError(null);
      })
      .catch((err: unknown) => {
        if (!isLiveRequest(lemmaSeq, token)) {
          return;
        }
        setTargetsError(formatAdminError(err, 'Không tải được từ của chủ đề.'));
      });
  }, [lemmaTopicId]);

  function pick(prompt: AdminPrompt | null): void {
    setSelected(prompt);
    setForm(
      prompt
        ? {
            externalKey: prompt.externalKey ?? '',
            textVi: prompt.textVi,
            topicId: prompt.topicId,
            sampleEn: prompt.sampleEn ?? '',
            hintsVi: prompt.hintsVi ?? '',
            targetLemmaIds: prompt.targetLemmaIds,
          }
        : EMPTY,
    );
    setError(null);
  }

  function toggleTarget(id: string): void {
    setForm((current) => {
      if (current.targetLemmaIds.includes(id)) {
        return { ...current, targetLemmaIds: current.targetLemmaIds.filter((item) => item !== id) };
      }
      if (current.targetLemmaIds.length >= CONTENT.PROMPT_TARGETS_MAX) {
        return current;
      }
      return { ...current, targetLemmaIds: [...current.targetLemmaIds, id] };
    });
  }

  function createBody(): Record<string, unknown> {
    return {
      externalKey: form.externalKey || undefined,
      textVi: form.textVi,
      topicId: form.topicId,
      targetLemmaIds: form.targetLemmaIds,
      sampleEn: form.sampleEn || undefined,
      hintsVi: form.hintsVi || undefined,
    };
  }

  async function create(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const created = await api<AdminPrompt>('/admin/prompts', {
        method: 'POST',
        json: createBody(),
      });
      await load();
      pick(created);
    } catch (err) {
      setError(formatAdminError(err, 'Không tạo được câu.'));
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
      const updated = await api<AdminPrompt>(`/admin/prompts/${selected.id}`, {
        method: 'PATCH',
        json: {
          externalKey: form.externalKey || null,
          textVi: form.textVi,
          topicId: form.topicId,
          targetLemmaIds: form.targetLemmaIds,
          sampleEn: form.sampleEn || null,
          hintsVi: form.hintsVi || null,
        },
      });
      await load();
      pick(updated);
    } catch (err) {
      setError(formatAdminError(err, 'Không lưu được câu.'));
    } finally {
      setPending(false);
    }
  }

  async function act(path: 'publish' | 'unpublish' | 'delete'): Promise<void> {
    if (selected === null) {
      return;
    }
    if (path === 'delete' && !window.confirm('Xóa mềm câu này?')) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (path === 'delete') {
        await api(`/admin/prompts/${selected.id}`, { method: 'DELETE' });
        pick(null);
      } else {
        const updated = await api<AdminPrompt>(`/admin/prompts/${selected.id}/${path}`, {
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

  const topicName = (id: string) =>
    topics.find((topic) => topic.id === id)?.nameVi ?? id.slice(0, 8);
  const targetsOk =
    form.targetLemmaIds.length >= CONTENT.PROMPT_TARGETS_MIN &&
    form.targetLemmaIds.length <= CONTENT.PROMPT_TARGETS_MAX;
  const publishMessages =
    selected === null
      ? []
      : promptPublishMessages({
          sampleEn: selected.sampleEn,
          targetLemmaIds: selected.targetLemmaIds,
          lemmas,
          lemmasMatchTopic: form.topicId === selected.topicId,
        });

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Câu</h1>
      <div className="flex flex-wrap gap-2">
        <select className={inputClass} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
          <option value="">Mọi chủ đề</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.nameVi}
            </option>
          ))}
        </select>
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
            placeholder="Tìm text_vi / external_key"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <Button type="submit">Tìm</Button>
        </form>
      </div>
      {catalogError ? <ErrorBanner message={catalogError} /> : null}
      {targetsError ? <ErrorBanner message={targetsError} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_26rem]">
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-busy={!loaded}>
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-1">
                  Câu VI
                </th>
                <th scope="col">Chủ đề</th>
                <th scope="col">Targets</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <EmptyTableRow cols={4}>Đang tải…</EmptyTableRow>
              ) : prompts.length === 0 ? (
                <EmptyTableRow cols={4}>Chưa có câu.</EmptyTableRow>
              ) : (
                prompts.map((prompt) => (
                  <tr
                    key={prompt.id}
                    tabIndex={0}
                    className={`cursor-pointer ${selectedId === prompt.id ? 'bg-accent/10' : ''}`}
                    onClick={() => pick(prompt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(prompt);
                      }
                    }}
                  >
                    <td className="max-w-md truncate py-1">{prompt.textVi}</td>
                    <td>{topicName(prompt.topicId)}</td>
                    <td>{prompt.targetLemmaIds.length}</td>
                    <td>
                      <StatusBadge status={prompt.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
        <Card className="grid gap-3">
          <h2 className="font-serif text-xl">{selected ? 'Sửa' : 'Tạo mới'}</h2>
          {selected && prompts.every((prompt) => prompt.id !== selected.id) ? (
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
            <Field label="external_key">
              <input
                className={inputClass}
                value={form.externalKey}
                onChange={(e) =>
                  setForm((current) => ({ ...current, externalKey: e.target.value }))
                }
              />
            </Field>
            <Field label={`text_vi (≤ ${CONTENT.PROMPT_TEXT_VI_MAX_LENGTH})`}>
              <textarea
                className={inputClass}
                value={form.textVi}
                maxLength={CONTENT.PROMPT_TEXT_VI_MAX_LENGTH}
                onChange={(e) => setForm((current) => ({ ...current, textVi: e.target.value }))}
              />
            </Field>
            <Field label="Chủ đề">
              <select
                className={inputClass}
                value={form.topicId}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    topicId: e.target.value,
                    targetLemmaIds: [],
                  }))
                }
              >
                <option value="">Chọn chủ đề</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.nameVi}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="sample_en">
              <textarea
                className={inputClass}
                value={form.sampleEn}
                onChange={(e) => setForm((current) => ({ ...current, sampleEn: e.target.value }))}
              />
            </Field>
            <Field label="hints_vi">
              <input
                className={inputClass}
                value={form.hintsVi}
                onChange={(e) => setForm((current) => ({ ...current, hintsVi: e.target.value }))}
              />
            </Field>
            <fieldset className="grid gap-1 text-sm">
              <legend className="text-muted">
                Target lemmas ({CONTENT.PROMPT_TARGETS_MIN}–{CONTENT.PROMPT_TARGETS_MAX})
              </legend>
              {lemmaTopicId.length === 0 ? (
                <p className="text-muted">Chọn chủ đề để thấy từ.</p>
              ) : lemmas.length === 0 ? (
                <p className="text-muted">Chủ đề này chưa có từ.</p>
              ) : (
                lemmas.map((lemma) => (
                  <label key={lemma.id} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={form.targetLemmaIds.includes(lemma.id)}
                      onChange={() => toggleTarget(lemma.id)}
                    />
                    {lemma.headword}
                    {lemma.status !== 'published' ? ' (draft)' : ''}
                  </label>
                ))
              )}
            </fieldset>
            {selected ? (
              <Button type="submit" disabled={pending || !targetsOk}>
                Lưu
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={
                  pending || form.textVi.length === 0 || form.topicId.length === 0 || !targetsOk
                }
              >
                Tạo nháp
              </Button>
            )}
          </form>
          {selected ? (
            <>
              {selected.status === 'draft'
                ? publishMessages.map((message) => (
                    <p key={message} className="text-sm text-muted">
                      {message}
                    </p>
                  ))
                : null}
              <ContentActions
                status={selected.status}
                pending={pending}
                publishDisabled={publishMessages.length > 0}
                onPublish={() => void act('publish')}
                onUnpublish={() => void act('unpublish')}
                onDelete={() => void act('delete')}
              />
            </>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => pick(null)}>
            Bỏ chọn
          </Button>
        </Card>
      </div>
    </div>
  );
}
