'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { formatAdminError } from '../../../lib/admin-error';
import { lemmaPublishDisabled } from '../../../lib/admin-publish';
import { withQuery } from '../../../lib/query-string';
import type { AdminLemma, AdminTopic, ContentStatus } from '../../../lib/admin-types';
import {
  ContentActions,
  EmptyTableRow,
  Field,
  StatusBadge,
  inputClass,
} from '../../../components/admin-ui';
import { Button, Card, ErrorBanner } from '../../../components/ui';

const EMPTY = {
  headword: '',
  pos: '',
  phonetic: '',
  senseVi: '',
  exampleEn: '',
  notesVi: '',
  topicId: '',
  includedInFree: false,
  cefr: '',
};

export default function AdminLemmasPage() {
  const [lemmas, setLemmas] = useState<AdminLemma[]>([]);
  const [topics, setTopics] = useState<AdminTopic[]>([]);
  const [topicId, setTopicId] = useState('');
  const [status, setStatus] = useState<ContentStatus | ''>('');
  const [includedInFree, setIncludedInFree] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('headword');
  const [selected, setSelected] = useState<AdminLemma | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const requestSeq = useRef(0);

  const selectedId = selected?.id ?? null;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await api<{ lemmas: AdminLemma[] }>(
        withQuery('/admin/lemmas', {
          topicId: topicId || undefined,
          status: status || undefined,
          includedInFree: includedInFree || undefined,
          q: q.trim() || undefined,
          sort,
        }),
      );
      if (seq !== requestSeq.current) {
        return;
      }
      setLemmas(res.lemmas);
      setLoaded(true);
      setError(null);
      setSelected((current) => {
        if (current === null) {
          return null;
        }
        return res.lemmas.find((lemma) => lemma.id === current.id) ?? current;
      });
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      setError(formatAdminError(err, 'Không tải được từ.'));
      setLoaded(true);
    }
  }, [includedInFree, q, sort, status, topicId]);

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

  function pick(lemma: AdminLemma | null): void {
    setSelected(lemma);
    setForm(
      lemma
        ? {
            headword: lemma.headword,
            pos: lemma.pos ?? '',
            phonetic: lemma.phonetic ?? '',
            senseVi: lemma.senseVi,
            exampleEn: lemma.exampleEn ?? '',
            notesVi: lemma.notesVi ?? '',
            topicId: lemma.topicId,
            includedInFree: lemma.includedInFree,
            cefr: lemma.cefr ?? '',
          }
        : EMPTY,
    );
    setError(null);
  }

  function patch<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function body(): Record<string, unknown> {
    return {
      headword: form.headword,
      pos: form.pos || undefined,
      phonetic: form.phonetic || undefined,
      senseVi: form.senseVi,
      exampleEn: form.exampleEn || undefined,
      notesVi: form.notesVi || undefined,
      topicId: form.topicId,
      includedInFree: form.includedInFree,
      cefr: form.cefr || undefined,
    };
  }

  async function create(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const created = await api<AdminLemma>('/admin/lemmas', { method: 'POST', json: body() });
      await load();
      pick(created);
    } catch (err) {
      setError(formatAdminError(err, 'Không tạo được từ.'));
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
      const json = {
        ...body(),
        pos: form.pos || null,
        phonetic: form.phonetic || null,
        exampleEn: form.exampleEn || null,
        notesVi: form.notesVi || null,
        cefr: form.cefr || null,
      };
      const updated = await api<AdminLemma>(`/admin/lemmas/${selected.id}`, {
        method: 'PATCH',
        json,
      });
      await load();
      pick(updated);
    } catch (err) {
      setError(formatAdminError(err, 'Không lưu được từ.'));
    } finally {
      setPending(false);
    }
  }

  async function act(path: 'publish' | 'unpublish' | 'delete'): Promise<void> {
    if (selected === null) {
      return;
    }
    if (path === 'delete' && !window.confirm('Xóa mềm từ này?')) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (path === 'delete') {
        await api(`/admin/lemmas/${selected.id}`, { method: 'DELETE' });
        pick(null);
      } else {
        const updated = await api<AdminLemma>(`/admin/lemmas/${selected.id}/${path}`, {
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

  return (
    <div className="grid gap-4">
      <h1 className="font-serif text-3xl">Từ</h1>
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
        <select
          className={inputClass}
          value={includedInFree}
          onChange={(e) => setIncludedInFree(e.target.value)}
        >
          <option value="">Free / Premium</option>
          <option value="true">included_in_free</option>
          <option value="false">premium only</option>
        </select>
        <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="headword">headword</option>
          <option value="createdAt">createdAt</option>
          <option value="updatedAt">updatedAt</option>
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
            placeholder="Tìm headword"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
          />
          <Button type="submit">Tìm</Button>
        </form>
      </div>
      {catalogError ? <ErrorBanner message={catalogError} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm" aria-busy={!loaded}>
            <thead>
              <tr className="text-muted">
                <th scope="col" className="py-1">
                  Headword
                </th>
                <th scope="col">Chủ đề</th>
                <th scope="col">Free</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <EmptyTableRow cols={4}>Đang tải…</EmptyTableRow>
              ) : lemmas.length === 0 ? (
                <EmptyTableRow cols={4}>Chưa có từ.</EmptyTableRow>
              ) : (
                lemmas.map((lemma) => (
                  <tr
                    key={lemma.id}
                    tabIndex={0}
                    className={`cursor-pointer ${selectedId === lemma.id ? 'bg-accent/10' : ''}`}
                    onClick={() => pick(lemma)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(lemma);
                      }
                    }}
                  >
                    <td className="py-1">{lemma.headword}</td>
                    <td>{topicName(lemma.topicId)}</td>
                    <td>{lemma.includedInFree ? 'có' : 'không'}</td>
                    <td>
                      <StatusBadge status={lemma.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
        <Card className="grid gap-3">
          <h2 className="font-serif text-xl">{selected ? 'Sửa' : 'Tạo mới'}</h2>
          {selected && lemmas.every((lemma) => lemma.id !== selected.id) ? (
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
            <Field label="Headword">
              <input
                className={inputClass}
                value={form.headword}
                onChange={(e) => patch('headword', e.target.value)}
              />
            </Field>
            <Field label="Chủ đề">
              <select
                className={inputClass}
                value={form.topicId}
                onChange={(e) => patch('topicId', e.target.value)}
              >
                <option value="">Chọn chủ đề</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.nameVi}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nghĩa tiếng Việt">
              <textarea
                className={inputClass}
                value={form.senseVi}
                onChange={(e) => patch('senseVi', e.target.value)}
              />
            </Field>
            <Field label="example_en">
              <textarea
                className={inputClass}
                value={form.exampleEn}
                onChange={(e) => patch('exampleEn', e.target.value)}
              />
            </Field>
            <Field label="POS">
              <input
                className={inputClass}
                value={form.pos}
                onChange={(e) => patch('pos', e.target.value)}
              />
            </Field>
            <Field label="Phonetic">
              <input
                className={inputClass}
                value={form.phonetic}
                onChange={(e) => patch('phonetic', e.target.value)}
              />
            </Field>
            <Field label="Ghi chú VI">
              <input
                className={inputClass}
                value={form.notesVi}
                onChange={(e) => patch('notesVi', e.target.value)}
              />
            </Field>
            <Field label="CEFR">
              <select
                className={inputClass}
                value={form.cefr}
                onChange={(e) => patch('cefr', e.target.value)}
              >
                <option value="">(không)</option>
                {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.includedInFree}
                onChange={(e) => patch('includedInFree', e.target.checked)}
              />
              included_in_free
            </label>
            {selected ? (
              <Button type="submit" disabled={pending}>
                Lưu
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={
                  pending ||
                  form.headword.length === 0 ||
                  form.senseVi.length === 0 ||
                  form.topicId.length === 0
                }
              >
                Tạo nháp
              </Button>
            )}
          </form>
          {selected ? (
            <>
              {selected.status === 'draft' && lemmaPublishDisabled(selected.exampleEn) ? (
                <p className="text-sm text-muted">Xuất bản cần example_en.</p>
              ) : null}
              <ContentActions
                status={selected.status}
                pending={pending}
                publishDisabled={lemmaPublishDisabled(selected.exampleEn)}
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
