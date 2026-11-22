import { useCompactLayout } from '../useCompactLayout.ts';
import { formatFileSize } from '../file-size.ts';
import { appHref } from '../routes.ts';
import { accept as uploadAccept } from '../BatchUpload.tsx';
import ProjectProfile from '../ProjectProfile.tsx';
import { groupMaterials, materialName } from '../material-groups.ts';
import { materialActivity } from '../material-activity.ts';
import { api, projectArchive } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useEffect, useState } from 'react';
import { Button, Tooltip } from '@gravity-ui/uikit';
import {
  RefreshCw,
  ArrowRight,
  Download,
  File,
  FileVideo,
  Folder,
  LoaderCircle,
  MessageSquare,
  Plus,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { Study, ChatSource } from '../types.ts';
import { plural } from '../shared/format.ts';
import { PageHeading } from '../shared/ProjectNavigation.tsx';
import { sourcesHeading, AnswerText } from '../shared/AnswerText.tsx';
import { FindingsDigest } from './Findings.tsx';
import { ProjectChatDock } from './GlobalChat.tsx';
import { sourceIcons } from './Library.tsx';

export function Home() {
  const { state, projectName, reader, real, receive } = useApp();
  const ready = state.studies.some((s) => s.status === 'ready' && s.segments?.length);
  return (
    <div className="project-overview">
      <PageHeading title={projectName} tabs />
      <div className="overview-grid overview-cards">
        <div className="overview-main">
          {state.workspace && (
            <ProjectProfile
              key={state.workspace.id}
              project={state.workspace}
              editable={real && !reader}
              onSave={receive}
            />
          )}
          <ProjectSummary key={state.workspace?.id} />
          <FindingsDigest />
        </div>
        <ProjectMaterials />
      </div>
      {ready ? <ProjectChatDock key={state.workspace?.id || 'project'} /> : null}
    </div>
  );
}

const summaryQuestions = [
  'Что исправить в первую очередь?',
  'Какие проблемы повторяются?',
  'Подготовь текст для презентации',
];

const summaryDate = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

const isActive = (s: Study) =>
  ['queued', 'running'].includes((s.activity || materialActivity(s)).state);

/** «Кратко»: the saved project summary from the model, with citations. A question chip swaps the block to its answer; «Общий обзор» swaps back. */
function ProjectSummary() {
  const { state, reader, real, receive, panel, setPanel } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // Answers to quick questions live in this block for the visit; they are not saved to the project.
  const [view, setView] = useState<string | null>(null),
    [answers, setAnswers] = useState<Record<string, { answer: string; sources: ChatSource[] }>>({}),
    [asking, setAsking] = useState<string | null>(null),
    [askError, setAskError] = useState('');
  const compact = useCompactLayout();
  const summary = state.projectSummary,
    ready = state.studies.some((s) => s.status === 'ready' && s.segments?.length),
    pending = state.studies.filter(isActive),
    readyCount = state.studies.filter((s) => s.status === 'ready').length;
  const model = state.models.find((m) => m.id === state.modelId);
  const canBuild = real && !reader && ready && model?.enabled && model.keyConfigured && model.model;
  const build = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      receive(await api('/api/project-summary', {}), true);
    } catch (e) {
      setError(e.status >= 500 ? 'Модель не смогла собрать сводку. Попробуйте позже.' : e.message);
    } finally {
      setBusy(false);
    }
  };
  const ask = async (question: string, force = false) => {
    setView(question);
    setAskError('');
    if ((answers[question] && !force) || asking) return;
    setAsking(question);
    try {
      const r = await api('/api/chat', { question });
      setAnswers((a) => ({ ...a, [question]: { answer: r.answer, sources: r.sources || [] } }));
    } catch (e) {
      setAskError(e.status >= 500 ? 'Модель не смогла ответить. Попробуйте позже.' : e.message);
    } finally {
      setAsking(null);
    }
  };
  // A new summary or another project starts from the overview again.
  useEffect(() => {
    setView(null);
    setAnswers({});
    setAskError('');
  }, [summary?.at]);
  if (!summary && reader) return null;
  const current = view ? answers[view] : null,
    cite = (list, key) => setPanel({ sources: list, heading: sourcesHeading(list), key });
  return (
    <section className="overview-summary" aria-labelledby="project-summary-title">
      <div className="overview-card">
        <div className="overview-card-inner">
          <div className="overview-card-head">
            <div>
              <h2 id="project-summary-title">Сводка проекта</h2>
              <p className="overview-card-sub">
                {summary ? 'Собрана Мнемодаком из материалов' : 'Ещё не создана'}
              </p>
            </div>
            {summary ? (
              <div className="summary-meta">
                {canBuild ? (
                  <Tooltip
                    content={error ? 'Повторить' : view ? 'Обновить ответ' : 'Обновить сводку'}
                  >
                    <Button
                      className="summary-refresh"
                      view="flat-secondary"
                      size={compact ? 'l' : 'm'}
                      loading={busy || Boolean(asking)}
                      disabled={busy || Boolean(asking)}
                      aria-label={error ? 'Повторить' : view ? 'Обновить ответ' : 'Обновить сводку'}
                      onClick={() => (view ? ask(view, true) : build())}
                    >
                      <RefreshCw size={16} aria-hidden="true" />
                      <span className="summary-refresh-label">
                        {error ? 'Повторить' : 'Обновить'}
                      </span>
                    </Button>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="summary-card">
            {pending.length ? (
              <p className="summary-pending" role="status">
                <LoaderCircle size={16} className="activity-spinner" aria-hidden="true" />
                {pending.length === 1
                  ? '«' + pending[0].title + '» обрабатывается.'
                  : plural(
                      pending.length,
                      'материал обрабатывается',
                      'материала обрабатываются',
                      'материалов обрабатывается',
                    ) + '.'}{' '}
                {canBuild ? 'Обновите сводку после обработки.' : null}
              </p>
            ) : null}
            {summary && view ? (
              <div className="summary-text" aria-live="polite" aria-busy={asking === view}>
                {asking === view ? (
                  <p className="summary-pending" role="status">
                    <LoaderCircle size={16} className="activity-spinner" aria-hidden="true" />
                    Готовим ответ…
                  </p>
                ) : askError ? (
                  <div className="task-error" role="alert">
                    <strong>Не удалось ответить</strong>
                    <p>{askError}</p>
                  </div>
                ) : current ? (
                  <AnswerText
                    id={'project-summary-' + summaryQuestions.indexOf(view)}
                    text={current.answer}
                    sources={current.sources}
                    onCite={cite}
                    active={panel?.key}
                  />
                ) : null}
              </div>
            ) : summary ? (
              <div className="summary-text" aria-live="polite">
                <AnswerText
                  id="project-summary"
                  text={summary.answer}
                  sources={summary.sources}
                  onCite={cite}
                  active={panel?.key}
                  lead
                />
              </div>
            ) : !busy && !error ? (
              <p className="summary-empty">
                {canBuild
                  ? 'ИИ соберёт основные выводы по материалам проекта и добавит ссылки на источники.'
                  : !state.studies.length
                    ? 'Сводка появится, когда в проекте будут материалы.'
                    : ready
                      ? 'Подключите модель в настройках проекта, чтобы создать сводку.'
                      : pending.length
                        ? 'Сводку можно создать после обработки материалов.'
                        : 'В материалах пока нет текста для сводки.'}
              </p>
            ) : null}
            {busy ? (
              <p className="summary-pending" role="status">
                <LoaderCircle size={16} className="activity-spinner" aria-hidden="true" />
                Создаём сводку…
              </p>
            ) : null}
            {error ? (
              <div className="task-error" role="alert">
                <strong>
                  {summary ? 'Не удалось обновить сводку' : 'Не удалось создать сводку'}
                </strong>
                <p>{error}</p>
              </div>
            ) : null}
            {!summary && canBuild ? (
              <div className="summary-actions">
                <Button
                  view="outlined"
                  size={compact ? 'l' : 'm'}
                  loading={busy}
                  disabled={busy}
                  onClick={build}
                >
                  {error ? 'Повторить' : 'Создать сводку'}
                </Button>
              </div>
            ) : null}
            {summary ? (
              <div className="summary-questions" role="group" aria-label="Что показать в сводке">
                <Button
                  className="summary-question"
                  view={view ? 'normal' : 'outlined-action'}
                  selected={!view}
                  aria-pressed={!view}
                  size={compact ? 'l' : 'm'}
                  pin="circle-circle"
                  onClick={() => {
                    setView(null);
                    setAskError('');
                  }}
                >
                  <Sparkles size={16} aria-hidden="true" />
                  Общий обзор
                </Button>
                {summaryQuestions.map((q) => (
                  <Button
                    key={q}
                    className="summary-question"
                    view={view === q ? 'outlined-action' : 'normal'}
                    selected={view === q}
                    aria-pressed={view === q}
                    size={compact ? 'l' : 'm'}
                    pin="circle-circle"
                    disabled={
                      !state.models.some((m) => m.enabled) || (Boolean(asking) && asking !== q)
                    }
                    onClick={() => ask(q)}
                  >
                    <MessageSquare size={16} aria-hidden="true" />
                    {q}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {summary ? (
            <div className="overview-card-foot">
              <span>{'Сформировано ' + summaryDate.format(summary.at).replace('.', '')}</span>
              {summary.materials < readyCount ? (
                <span className="overview-card-warn">
                  {'Учтено ' +
                    summary.materials +
                    ' из ' +
                    plural(readyCount, 'материала', 'материалов', 'материалов')}
                </span>
              ) : (
                <span>
                  {'По ' + plural(summary.materials, 'материалу', 'материалам', 'материалам')}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The same file-type icons as the materials table. */
function MaterialIcon({ study }: { study: Study }) {
  const ext = study.fileName
    ?.trim()
    .match(/^.+\.([a-z0-9]{1,12})$/i)?.[1]
    ?.toLowerCase();
  const Icon =
    ext && Object.hasOwn(sourceIcons, ext)
      ? sourceIcons[ext]
      : study.format === 'Видео'
        ? FileVideo
        : File;
  return <Icon className="material-rail-icon" size={20} aria-hidden="true" />;
}

const materialMeta = (s: Study) =>
  [
    s.type,
    s.duration >= 60
      ? Math.round(s.duration / 60) + ' мин'
      : s.processing?.pages
        ? s.processing.pages + ' стр.'
        : '',
    formatFileSize(s.fileSize),
  ]
    .filter((x) => x && x !== '—')
    .join(' · ');

/** Second line of a material in the overview column: its facts, or what is happening to it, as plain text. */
function MaterialProgress({ study: s }: { study: Study }) {
  const activity = s.activity || materialActivity(s);
  if (s.status === 'ready' && !isActive(s))
    return <span className="material-rail-meta">{materialMeta(s)}</span>;
  if (activity.state === 'error')
    return <span className="material-rail-meta material-rail-error">{activity.label}</span>;
  if (!isActive(s)) return <span className="material-rail-meta">{activity.label}</span>;
  // The text says what is going on; the dots only show it is still moving.
  return (
    <span className="material-rail-meta" role="status">
      {(activity.detail || activity.label).replace(/[.…]+$/u, '')}
      <span className="progress-dots" aria-hidden="true">
        <i>.</i>
        <i>.</i>
        <i>.</i>
      </span>
    </span>
  );
}

// The overview card stays short: the full list lives on the materials tab.
const RAIL_LIMIT = 8;

const isRecording = (s: Study) => s.format === 'Видео' || s.duration >= 60;

/** One file of a row as a small link: a recording shows its length, a document its size. */
function MaterialChip({ study: s, single }: { study: Study; single: boolean }) {
  const activity = s.activity || materialActivity(s),
    busy = isActive(s) || s.status === 'error';
  const text = busy
    ? activity.label
    : single
      ? materialMeta(s)
      : isRecording(s)
        ? Math.round(s.duration / 60) + ' мин'
        : [
            'Текст',
            s.processing?.pages ? s.processing.pages + ' стр.' : '',
            formatFileSize(s.fileSize),
          ]
            .filter((x) => x && x !== '—')
            .join(' · ');
  return (
    <a
      className={'material-chip' + (s.status === 'error' ? ' material-chip_error' : '')}
      href={appHref('study/' + s.id)}
      title={s.fileName || s.title}
    >
      {!busy && !single && isRecording(s) ? <FileVideo size={12} aria-hidden="true" /> : null}
      {text}
    </a>
  );
}

/** Overview card of materials: report first, then work in progress and fresh files, grouped by name; one ZIP for all files. */
function ProjectMaterials() {
  const { state, open, reader } = useApp(),
    compact = useCompactLayout();
  const busy = (s: Study) => isActive(s) || s.status === 'error';
  const list = state.studies
    .toReversed()
    .sort(
      (a, b) =>
        Number(b.type === 'Отчёт') - Number(a.type === 'Отчёт') ||
        Number(busy(b)) - Number(busy(a)) ||
        b.date.localeCompare(a.date),
    );
  const files = list.filter((s) => s.fileId && s.status === 'ready'),
    total = files.reduce((sum, s) => sum + (s.fileSize || 0), 0);
  const groups = groupMaterials<Study>(list),
    shown: Study[][] = [];
  let count = 0;
  for (const g of groups) {
    if (shown.length && count + g.length > RAIL_LIMIT) break;
    shown.push(g);
    count += g.length;
  }
  return (
    <section className="overview-materials" aria-labelledby="project-materials-title">
      <div className="overview-card">
        <div className="overview-card-inner">
          <div className="overview-card-head">
            <h2 id="project-materials-title">
              Материалы{list.length ? <span className="section-count">{list.length}</span> : null}
            </h2>
            {reader || !list.length ? null : (
              <Tooltip content="Добавить файл">
                <Button
                  view="outlined"
                  size={compact ? 'l' : 'm'}
                  aria-label="Добавить файл"
                  onClick={() => open({ type: 'upload' })}
                >
                  <Plus size={16} aria-hidden="true" />
                </Button>
              </Tooltip>
            )}
          </div>
          <div className="overview-materials-body">
            {list.length ? (
              <ul className="material-groups" aria-label="Материалы проекта">
                {shown.map((g) => (
                  <li key={g[0].id}>
                    <div className="material-group-name">
                      <MaterialIcon study={g[0]} />
                      <a href={appHref('study/' + g[0].id)} title={g[0].title}>
                        {g.length > 1 ? materialName(g[0].title) : g[0].title}
                      </a>
                      {g.length > 1 ? (
                        <span className="material-group-count">
                          {plural(g.length, 'файл', 'файла', 'файлов')}
                        </span>
                      ) : null}
                    </div>
                    <div className="material-chips">
                      {g.map((s) => (
                        <MaterialChip key={s.id} study={s} single={g.length === 1} />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : reader ? (
              <div className="project-empty material-rail-empty">
                <span className="project-folder">
                  <Folder size={24} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <h3>Материалов пока нет</h3>
                <p>Здесь появятся записи интервью, расшифровки и отчёт исследования.</p>
              </div>
            ) : (
              <label className="project-empty material-rail-empty">
                <input
                  type="file"
                  multiple
                  accept={uploadAccept}
                  className="sr-only"
                  onChange={(e) => {
                    const files = [...(e.currentTarget.files || [])];
                    e.currentTarget.value = '';
                    if (files.length) open({ type: 'upload', files });
                  }}
                />
                <span className="project-folder">
                  <Upload size={24} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <h3>Материалов пока нет</h3>
                <p>
                  Загрузите записи интервью, расшифровки или отчёт. Мнемодак расшифрует записи и
                  предложит находки.
                </p>
                <span className="material-rail-empty-action">Выбрать файлы</span>
              </label>
            )}
          </div>
          {list.length ? (
            <div className="overview-card-foot">
              <a href={appHref('library')}>
                Все материалы
                <ArrowRight size={14} aria-hidden="true" />
              </a>
              {files.length > 1 ? (
                <a href={projectArchive()} download>
                  <Download size={14} aria-hidden="true" />
                  {'Скачать всё' + (total ? ' · ' + formatFileSize(total) : '')}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
