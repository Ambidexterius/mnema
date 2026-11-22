import { appHref, navigate } from '../routes.ts';
import DocumentPreview from '../DocumentPreview.tsx';
import { renderText } from '../extension.tsx';
import StudyExperience from '../StudyExperience.tsx';
import { projectFile } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useEffect, useRef, useState } from 'react';
import { Button, Label, Tooltip } from '@gravity-ui/uikit';
import { ArrowRight, FileText, X } from 'lucide-react';
import type { Segment, ChatSource } from '../types.ts';
import { transcript } from '../data.ts';
import { DEMO } from '../state/constants.ts';
import { normalize, reportOf } from '../state/normalize.ts';
import { plural, where, time } from '../shared/format.ts';
import { IconButton, Empty } from '../shared/ui.tsx';
import { FindingMeta, History } from './Findings.tsx';

export function FileWindow() {
  const { state, route } = useApp();
  const study = state.studies.find((s) => s.id === route.slice(5));
  return (
    <main className="file-window" id="main">
      <header className="file-window-header">
        <FileText size={20} aria-hidden="true" />
        <div>
          <span className="muted">Исходный файл</span>
          <h1>{study?.fileName || study?.title || 'Открываем файл…'}</h1>
        </div>
        <Button view="flat" aria-label="Закрыть окно файла" onClick={() => window.close()}>
          <X size={20} />
        </Button>
      </header>
      {study?.fileId ? (
        <DocumentPreview
          fileId={study.fileId}
          file={projectFile(study.fileId)}
          name={study.fileName || study.title}
          standalone
        />
      ) : state.workspace ? (
        <Empty title="Файл недоступен">
          Проверьте доступ к проекту и откройте материал ещё раз.
        </Empty>
      ) : (
        <p role="status">Открываем исходный файл…</p>
      )}
    </main>
  );
}

export function StudyModal({ back, animateEntry }: { back: string; animateEntry: boolean }) {
  const { route, state } = useApp();
  const study = state.studies.find((s) => route === 'study/' + s.id);
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaving = useRef(false);
  const [closing, setClosing] = useState(false);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    if (history.state?.returnTo) history.back();
    else navigate(back, true);
  };
  const close = (immediate = false) => {
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      leave();
      return;
    }
    if (leaving.current || closeTimer.current !== null) return;
    setClosing(true);
    // A transition may not run when the window is closed during its first frame.
    closeTimer.current = setTimeout(leave, 180);
  };
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    // VoiceOver can still reach the page under an aria-modal sheet; make that page inert instead.
    // Live regions (toasts) stay reachable so status messages are still announced.
    const muted: HTMLElement[] = [];
    for (
      let node: HTMLElement | null = box.current?.parentElement || null;
      node && node !== document.body;
      node = node.parentElement
    )
      for (const sibling of Array.from(node.parentElement?.children || []) as HTMLElement[])
        if (
          sibling !== node &&
          !sibling.inert &&
          !sibling.matches('script,style,[role=status],[role=alert],[aria-live]')
        ) {
          sibling.inert = true;
          muted.push(sibling);
        }
    box.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const sheet = box.current;
      if (!sheet) return;
      if (
        document.querySelector('.g-modal_open,.g-popup_open') &&
        !sheet.contains(document.activeElement) &&
        document.activeElement !== document.body
      )
        return;
      const visible = (node: HTMLElement) =>
        node.getClientRects().length > 0 &&
        !node.closest('[inert],[aria-hidden="true"]') &&
        getComputedStyle(node).visibility === 'visible';
      if (
        Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role=dialog],.source-panel,.g-popup_open [role=menu],.g-popup_open [role=listbox]',
          ),
        ).some((node) => node !== sheet && visible(node))
      )
        return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      }
      const controls = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[controls],[contenteditable=true],[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.getAttribute('tabindex') !== '-1' && visible(node));
      const first = controls[0],
        last = controls.at(-1),
        active = document.activeElement;
      if (!first) {
        e.preventDefault();
        sheet.focus();
        return;
      }
      if (
        !sheet.contains(active) ||
        active === sheet ||
        (e.shiftKey ? active === first : active === last)
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    // Tooltips can consume Escape before it reaches the window in the bubble phase.
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) key(e);
    };
    const tab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') key(e);
    };
    window.addEventListener('keydown', escape, true);
    window.addEventListener('keydown', tab);
    return () => {
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('keydown', tab);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      root.style.overflow = overflow;
      for (const node of muted) node.inert = false;
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="study-layer"
      data-animate-entry={animateEntry || undefined}
      data-closing={closing || undefined}
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) close();
      }}
    >
      <div className="study-backdrop" aria-hidden="true" />
      <div
        ref={box}
        className="study-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={study?.title || 'Материал'}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (closing && e.target === e.currentTarget && e.propertyName === 'opacity') leave();
        }}
      >
        <header className="study-sheet-bar">
          <h1>{study?.title || 'Материал'}</h1>
          <div className="study-sheet-actions">
            <div ref={setHeaderActions} />
            <IconButton icon={X} label="Закрыть материал" onClick={(e) => close(e.detail === 0)} />
          </div>
        </header>
        <div className="study-sheet-scroll">
          <StudyScreen key={route} headerActions={headerActions} />
        </div>
      </div>
    </div>
  );
}

export function StudyScreen({ headerActions }: { headerActions?: HTMLDivElement | null }) {
  const ctx = useApp();
  const study = ctx.state.studies.find((s) => ctx.route === 'study/' + s.id);
  if (!study)
    return (
      <Empty
        title="Материал не найден"
        action={<Button href={appHref('library')}>Открыть исследования</Button>}
      >
        Выберите материал в исследованиях.
      </Empty>
    );
  const points = ctx.state.findings.filter((f) => f.studyId === study.id);
  return (
    <StudyExperience
      key={study.id}
      ctx={ctx}
      study={study}
      reader={ctx.reader}
      demo={DEMO}
      findings={points.map(normalize)}
      headerActions={headerActions}
    />
  );
}

export function SourcePanel() {
  const { panel, panelClosing, setPanel, state, go, openGlobalSource, reader } = useApp();
  const list = useRef(null),
    media = useRef(null),
    closeButton = useRef(null);
  const [mediaError, setMediaError] = useState('');
  const study = panel && state.studies.find((s) => s.id === panel.studyId);
  const segments: Segment[] = study?.segments?.length
    ? study.segments
    : DEMO && study?.id === 'calendar'
      ? transcript
      : [];
  const index = segments.findIndex((t) => t.id === panel?.segmentId);
  const seg = index >= 0 ? segments[index] : null;
  const finding = panel?.findingId
    ? state.findings.map(normalize).find((f) => f.id === panel.findingId)
    : null;
  const isMedia = Boolean(study?.fileId && study.format === 'Видео');
  const isPDF = Boolean(study?.fileId && /\.pdf$/i.test(study.fileName || ''));
  useEffect(() => {
    if (!panel) return;
    const before = document.activeElement as HTMLElement;
    closeButton.current?.focus();
    requestAnimationFrame(() =>
      list.current?.querySelector('.segment.selected')?.scrollIntoView({ block: 'nearest' }),
    );
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [panel?.studyId, panel?.key]);
  if (!panel) return null;
  const close = () => setPanel(null);
  // List mode: quotes come with the answer, so it opens instantly; «Открыть фрагмент» switches to the detailed view.
  if (panel.sources) {
    const groups = [
      ...new Map<string, ChatSource[]>(
        panel.sources.map((x) => [
          x.studyId,
          panel.sources!.filter((y) => y.studyId === x.studyId),
        ]),
      ).values(),
    ];
    return (
      <aside
        className="source-panel"
        data-closing={panelClosing || undefined}
        aria-label="Источники"
        aria-modal="false"
      >
        <div className="source-panel-head">
          <div>
            <div className="overline">
              {plural(panel.sources.length, 'цитата', 'цитаты', 'цитат')}
            </div>
            <h2>{panel.heading}</h2>
          </div>
          <Tooltip content="Закрыть источники">
            <Button
              ref={closeButton}
              view="flat"
              size="l"
              aria-label="Закрыть источники"
              onClick={close}
            >
              <X size={18} />
            </Button>
          </Tooltip>
        </div>
        <div className="source-panel-body source-list">
          {groups.map((list) => (
            <section key={list[0].studyId} className="source-group">
              {groups.length > 1 || list[0].title !== panel.heading ? (
                <h3>{list[0].title}</h3>
              ) : null}
              {list[0].workspaceName ? (
                <p className="source-group-project">{list[0].workspaceName}</p>
              ) : null}
              {list.map((x) => (
                <figure key={x.segmentId} className="source-quote">
                  <blockquote>«{renderText(x.correctedText ?? x.text)}»</blockquote>
                  <figcaption>
                    <span>
                      {x.speaker} · {where(x)}
                    </span>
                    <Button view="flat" size="s" onClick={() => openGlobalSource(x)}>
                      Открыть фрагмент
                      <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </section>
          ))}
        </div>
      </aside>
    );
  }
  const problem = !study
    ? ['Источник удалён', 'Материал, на который ссылается вывод, больше недоступен.']
    : !seg
      ? [
          'Фрагмент не найден',
          'Материал мог быть обработан заново, и фрагмент изменился. Проверьте находку по всему материалу.',
        ]
      : mediaError
        ? ['Таймкод за пределами записи', mediaError]
        : null;
  return (
    <aside
      className="source-panel"
      data-closing={panelClosing || undefined}
      aria-label="Источник"
      aria-modal="false"
    >
      <div className="source-panel-head">
        <div>
          <div className="overline">Источник</div>
          <h2>{study?.title || 'Материал'}</h2>
          {study ? (
            <div className="finding-meta">
              <Label size="s">{study.type}</Label>
              <Label size="s" theme={reportOf(study) === 'none' ? 'warning' : 'success'}>
                {reportOf(study) === 'none' ? 'По сырым данным' : 'Отчёт исследователя'}
              </Label>
              {seg ? (
                <Label size="s" theme="info">
                  {where(seg)}
                </Label>
              ) : null}
            </div>
          ) : null}
        </div>
        <Tooltip content="Закрыть источник">
          <Button
            ref={closeButton}
            view="flat"
            size="l"
            aria-label="Закрыть источник"
            onClick={close}
          >
            <X size={18} />
          </Button>
        </Tooltip>
      </div>
      <div className="source-panel-body">
        {finding ? (
          <section className="panel-finding">
            <FindingMeta f={finding} />
            <h3>{finding.title}</h3>
            {finding.description ? <p>{finding.description}</p> : null}
            {reader ? null : <History f={finding} />}
          </section>
        ) : null}
        {problem ? (
          <div className="panel-error" role="alert">
            <strong>{problem[0]}</strong>
            <p>{problem[1]}</p>
            {study ? (
              <Button
                onClick={(e) => {
                  close();
                  go('study/' + study.id, null, e.detail > 0);
                }}
              >
                Открыть весь материал
              </Button>
            ) : null}
          </div>
        ) : null}
        {study && seg ? (
          <>
            {isMedia ? (
              <video
                ref={media}
                src={projectFile(study.fileId)}
                controls
                preload="metadata"
                className="panel-media"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && seg.time > d)
                    setMediaError(
                      'Фрагмент указывает на ' +
                        time(seg.time) +
                        ', а запись длится ' +
                        time(d) +
                        '.',
                    );
                  else e.currentTarget.currentTime = seg.time;
                }}
              />
            ) : null}
            {isPDF ? (
              <iframe
                title={'Исходный PDF, страница ' + (seg.page || 1)}
                className="panel-pdf"
                src={projectFile(study.fileId) + '#page=' + (seg.page || 1)}
              />
            ) : null}
            <div className="panel-segments" ref={list}>
              {segments.slice(Math.max(0, index - 2), index + 3).map((t) => (
                <article
                  key={t.id}
                  className={'segment ' + (t.id === seg.id ? 'selected' : '')}
                  aria-current={t.id === seg.id ? 'true' : undefined}
                >
                  <div className="segment-head">
                    <strong>{t.speaker}</strong>
                    <Button
                      view="flat"
                      size="s"
                      onClick={() => {
                        if (media.current && !t.page) media.current.currentTime = t.time;
                        setPanel((p) => ({
                          ...p,
                          segmentId: t.id,
                          number: t.id === panel.segmentId ? p.number : undefined,
                        }));
                      }}
                      aria-label={'Перейти к ' + where(t)}
                    >
                      {where(t)}
                    </Button>
                  </div>
                  <p>
                    {t.correctedText ?? t.text}
                    {t.correctedText !== undefined ? (
                      <small className="correction-label"> (исправлено)</small>
                    ) : null}
                  </p>
                </article>
              ))}
            </div>
            <Button
              view="outlined"
              width="max"
              onClick={(e) => {
                close();
                go('study/' + study.id, seg.id, e.detail > 0);
              }}
            >
              Открыть в материале
              <ArrowRight size={16} />
            </Button>
          </>
        ) : null}
      </div>
    </aside>
  );
}
