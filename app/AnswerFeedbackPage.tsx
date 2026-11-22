import React, { useEffect, useState } from 'react';
import { Button, SegmentedRadioGroup } from '@gravity-ui/uikit';
import { ChevronRight, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from './api.ts';
import EmptyState from './EmptyState.tsx';

type Item = {
  id: string;
  rating: 'up' | 'down';
  updated: number;
  userName: string;
  question: string;
  answer: string;
  model: string;
  kind: 'generated' | 'no-evidence';
  projects: { id: string; name: string }[];
  sources: { projectId: string; studyId: string; title: string }[];
};
const when = (t: number) =>
  new Date(t).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// Admin review of 👍/👎 on chat answers: what was asked, what the model said and which materials it used.
export default function AnswerFeedbackPage({ real }: { real: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState('down');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(
        real
          ? (await api<{ feedback: Item[] }>('/api/chat/feedback', undefined, 'GET', false))
              .feedback
          : [],
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [real]);
  const count = (r: string) => (items || []).filter((i) => i.rating === r).length;
  const shown = (items || []).filter((i) => filter === 'all' || i.rating === filter);
  return (
    <div className="feedback-settings">
      <p className="settings-note settings-copy">
        Проверяйте ответы, которые оценили коллеги. Это поможет найти ошибки в поиске, источниках и
        формулировках.
      </p>
      <div className="settings-group-head">
        <SegmentedRadioGroup
          size="m"
          name="Оценки"
          value={filter}
          onUpdate={setFilter}
          options={[
            {
              value: 'down',
              content: (
                <>
                  <ThumbsDown size={14} aria-hidden="true" />
                  <span className="feedback-filter-text">Неполезные</span> {count('down')}
                </>
              ),
            },
            {
              value: 'up',
              content: (
                <>
                  <ThumbsUp size={14} aria-hidden="true" />
                  <span className="feedback-filter-text">Полезные</span> {count('up')}
                </>
              ),
            },
            { value: 'all', content: 'Все' },
          ]}
        />
        <Button view="flat-secondary" size="s" onClick={load} loading={loading}>
          Обновить
        </Button>
      </div>
      {error ? (
        <div className="processing-notice" role="alert">
          <p>{error}</p>
          <Button onClick={load}>Повторить</Button>
        </div>
      ) : null}
      {items === null && !error ? <p role="status">Загружаем оценки…</p> : null}
      {items && shown.length ? (
        <ul className="settings-list" aria-label="Оценённые ответы">
          {shown.map((i) => (
            <li className="setting-row feedback-row" key={i.id}>
              <details>
                <summary>
                  <span
                    className="setting-icon"
                    data-status={i.rating === 'up' ? 'on' : 'warn'}
                    aria-hidden="true"
                  >
                    {i.rating === 'up' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
                  </span>
                  <span className="setting-main">
                    <strong>{i.question}</strong>
                    <span className="setting-sub">
                      {i.userName} · {when(i.updated)} ·{' '}
                      {i.projects.map((p) => p.name).join(', ') || 'Все проекты'}
                    </span>
                  </span>
                  <ChevronRight size={16} className="feedback-chevron" aria-hidden="true" />
                </summary>
                <div className="feedback-detail">
                  <h4>
                    Ответ{i.kind === 'no-evidence' ? ' — в материалах ничего не нашлось' : ''}
                  </h4>
                  <p className="feedback-answer">{i.answer}</p>
                  <h4>Источники</h4>
                  {i.sources.length ? (
                    <ul className="feedback-sources">
                      {i.sources.map((s) => (
                        <li key={s.projectId + s.studyId}>
                          {s.title}
                          <span className="setting-meta">
                            {i.projects.find((p) => p.id === s.projectId)?.name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="setting-sub">Ответ без ссылок на материалы.</p>
                  )}
                  <p className="setting-sub">Модель: {i.model || 'не указана'}</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : items && !loading && !error ? (
        <EmptyState
          icon={
            filter === 'down' && items.length ? <ThumbsDown size={28} /> : <ThumbsUp size={28} />
          }
          title={
            !items.length
              ? 'Оценок пока нет'
              : filter === 'down'
                ? 'Нет неполезных ответов'
                : 'Нет полезных ответов'
          }
          description={
            !items.length
              ? 'Здесь появятся ответы, которые оценят коллеги.'
              : 'Выберите «Все», чтобы посмотреть остальные оценки.'
          }
        />
      ) : null}
    </div>
  );
}
