import { appHref, navigateHref } from '../routes.ts';
import { renderText } from '../extension.tsx';
import { useApp } from '../app-context.ts';
import { Button, Tooltip } from '@gravity-ui/uikit';
import { ArrowLeft, Check, Folder, Pencil, RotateCcw, X } from 'lucide-react';
import type { Finding, Segment } from '../types.ts';
import { normalize } from '../state/normalize.ts';
import { importanceTheme, segmentsOf, where, fullDate } from '../shared/format.ts';
import { Empty } from '../shared/ui.tsx';
import { useRepeats, FindingMeta, History } from './Findings.tsx';

export function FindingPage() {
  const { state, route, openPanel, update, open, notify, projectName, reader } = useApp();
  const repeats = useRepeats();
  const all = state.findings.map(normalize);
  const f = all.find((x) => 'finding/' + x.id === route.split('?')[0]);
  const findingRoot = history.state?.findingsRoot || appHref('findings');
  if (!f)
    return (
      <Empty
        title={reader ? 'Находка ещё не проверена' : 'Находка не найдена'}
        action={<Button href={findingRoot}>Открыть находки</Button>}
      >
        {reader ? 'Она появится здесь после проверки или была удалена.' : 'Возможно, её удалили.'}
      </Empty>
    );
  const study = state.studies.find((s) => s.id === f.studyId);
  const segs = segmentsOf(study);
  const evidence = [...new Set([f.segmentId, ...(f.evidence || [])])]
    .map((id) => segs.find((t) => t.id === id))
    .filter(Boolean) as Segment[];
  const info = repeats.get(f.id);
  const similar = (info?.similar || [])
    .map((id) => all.find((x) => x.id === id))
    .filter(Boolean) as Finding[];
  const materials = info?.materials || 1;
  const ready = state.studies.filter((s) => s.status === 'ready').length;
  const setStatus = async (next, message) => {
    if (
      await update((s) => ({
        findings: s.findings.map((x) => (x.id === f.id ? { ...normalize(x), status: next } : x)),
      }))
    )
      notify(message);
  };
  const speaker = (seg: Segment) =>
    seg.speaker &&
    !['Запись', 'Документ'].includes(seg.speaker) &&
    !seg.speaker.startsWith('Страница ')
      ? seg.speaker + ' · '
      : '';
  return (
    <article className="finding-page">
      <div className="page-title-row">
        <Tooltip content="Назад">
          <a
            className="page-back"
            href={findingRoot}
            aria-label="Назад к находкам"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              if (history.state?.previous === findingRoot) history.back();
              else navigateHref(findingRoot, true);
            }}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </a>
        </Tooltip>
        <h1>{f.title}</h1>
      </div>
      <div className="finding-page-status">
        <FindingMeta f={f} />
        {reader ? null : (
          <div className="row-actions">
            {f.status === 'draft' ? (
              <>
                <Button
                  size="m"
                  view="action"
                  onClick={() => setStatus('verified', 'Находка принята.')}
                >
                  <Check size={16} />
                  Принять
                </Button>
                <Button
                  size="m"
                  view="outlined"
                  onClick={() => open({ type: 'finding', findingId: f.id, accept: true })}
                >
                  <Pencil size={16} />
                  Принять с правкой
                </Button>
                <Button
                  size="m"
                  view="flat"
                  onClick={() => setStatus('rejected', 'Находка отклонена.')}
                >
                  <X size={16} />
                  Отклонить
                </Button>
              </>
            ) : f.status === 'verified' ? (
              <>
                <Button
                  size="m"
                  view="outlined"
                  onClick={() => open({ type: 'finding', findingId: f.id })}
                >
                  <Pencil size={16} />
                  Изменить
                </Button>
                <Button
                  size="m"
                  view="flat"
                  onClick={() =>
                    setStatus(
                      'draft',
                      'Находка возвращена на проверку и скрыта от участников с просмотром.',
                    )
                  }
                >
                  <RotateCcw size={16} />
                  Вернуть на проверку
                </Button>
              </>
            ) : (
              <Button
                size="m"
                view="outlined"
                onClick={() => setStatus('draft', 'Находка возвращена на проверку.')}
              >
                <RotateCcw size={16} />
                Вернуть на проверку
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="finding-page-grid">
        <section className="finding-block" aria-labelledby="finding-evidence-title">
          {f.reason ? (
            <div className="finding-reason">
              <strong className={'importance-' + importanceTheme(f.importance)}>
                {f.importance}
              </strong>
              <p>{f.reason}</p>
              {f.origin === 'ai' ? (
                <small>Оценка ИИ. Изменится, если поменять важность.</small>
              ) : null}
            </div>
          ) : null}
          {f.description ? <p className="finding-description">{f.description}</p> : null}
          <h2 id="finding-evidence-title">Доказательства</h2>
          {evidence.length ? (
            <ul className="evidence-list">
              {evidence.map((seg) => (
                <li key={seg.id}>
                  <button
                    type="button"
                    className="evidence-quote"
                    onClick={() =>
                      openPanel({ studyId: f.studyId, segmentId: seg.id, findingId: f.id })
                    }
                  >
                    <span>«{renderText(seg.correctedText ?? seg.text)}»</span>
                    <small>
                      {speaker(seg)}
                      {where(seg)} · {study?.title}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Фрагмент источника недоступен: материал удалён или обработан заново.
            </p>
          )}
          {f.origin === 'ai' && f.status === 'draft' ? (
            <p className="finding-hint">
              Формулировку предложил ИИ. Откройте цитату и сверьте вывод с источником, прежде чем
              принять.
            </p>
          ) : null}
        </section>
        <aside className="finding-side">
          <section className="finding-block" aria-labelledby="finding-repeat-title">
            <h2 id="finding-repeat-title">Повторяемость</h2>
            <p className="repeat-number">
              {materials > 1 ? (
                <>
                  <strong>{materials}</strong> из {ready} материалов
                </>
              ) : similar.length ? (
                'Только в этом материале'
              ) : ready > 1 ? (
                <>
                  <strong>1</strong> из {ready} материалов
                </>
              ) : (
                'Один материал'
              )}
            </p>
            <p className="muted">
              {materials > 1
                ? 'Похожие находки есть в других материалах проекта.'
                : similar.length
                  ? 'Похожие находки есть в этом же материале.'
                  : ready > 1
                    ? 'В других материалах похожих находок нет.'
                    : 'В проекте один готовый материал — сравнивать не с чем.'}
            </p>
            {similar.length ? (
              <>
                <ul className="similar-list">
                  {similar.slice(0, 6).map((x) => (
                    <li key={x.id}>
                      <a href={appHref('finding/' + x.id)}>{x.title}</a>
                      <small>{state.studies.find((s) => s.id === x.studyId)?.title}</small>
                    </li>
                  ))}
                </ul>
                {similar.length > 6 ? <p className="muted">И ещё {similar.length - 6}.</p> : null}
                <p className="finding-hint">
                  Сходство считается по совпадению слов в формулировках. Проверьте по источникам,
                  что это одна и та же мысль.
                </p>
              </>
            ) : null}
          </section>
          {study ? (
            <section className="finding-block" aria-labelledby="finding-study-title">
              <h2 id="finding-study-title">Материал</h2>
              <a className="finding-study-link" href={appHref('study/' + study.id)}>
                {study.title}
              </a>
              <p className="muted">
                {study.type} · {fullDate(study.date)}
              </p>
              <a className="finding-project-link" href={appHref('home')}>
                <Folder size={14} aria-hidden="true" />
                Проект «{projectName}»
              </a>
              {f.basis === 'raw' ? (
                <p className="finding-hint">
                  Отчёта по этому исследованию нет: вывод сделан по сырым данным.
                </p>
              ) : null}
            </section>
          ) : null}
          {f.history?.length ? (
            <section className="finding-block" aria-label="История проверки">
              <h2>История</h2>
              <History f={f} />
            </section>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
