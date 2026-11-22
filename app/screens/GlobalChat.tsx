import { appHref, routeHref } from '../routes.ts';
import ThinkingIndicator from '../ThinkingIndicator.tsx';
import Mascot, { type MascotMood } from '../Mascot.tsx';
import AnswerActions from '../AnswerActions.tsx';
import ChatComposer from '../ChatComposer.tsx';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@gravity-ui/uikit';
import { ArrowLeft, ArrowRight, Minimize2, MessageSquare, Quote } from 'lucide-react';
import type { ChatSource } from '../types.ts';
import { plural } from '../shared/format.ts';
import { IconButton } from '../shared/ui.tsx';
import { sourcesHeading, revealMessage, AnswerText, materialCount } from '../shared/AnswerText.tsx';

// The agent reads the error: an exhausted limit makes it sleepy, a provider refusal angry, a lost connection dizzy.
const errorMood = (text: string): MascotMood =>
  /лимит/i.test(text)
    ? 'sleepy'
    : /отклонил|403/.test(text)
      ? 'angry'
      : /недоступ|соединени|сеть|504|тайм/i.test(text)
        ? 'dizzy'
        : 'sad';

const projectQuestions = [
  'Какие основные идеи есть в этом проекте?',
  'Какие проблемы повторяются?',
  'Что осталось невыясненным?',
];

/** Project overview chat: a real saved conversation, pinned to the project and listed in recent chats. */
export function ProjectChatDock() {
  const {
    state,
    chatHistory,
    globalMessages: messages,
    globalTyping: typing,
    globalError,
    askGlobal,
    go,
  } = useApp();
  const [draft, setDraft] = useState(''),
    [example, setExample] = useState(0),
    [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [open, setOpen] = useState(false);
  const dock = useRef<HTMLElement>(null),
    enabled = state.models.some((x) => x.enabled),
    ready = state.studies.some((s) => s.status === 'ready'),
    available = enabled && ready;
  const projectId = state.workspace?.id,
    chatId = chatHistory.chats.find((c) => c.projectId === projectId)?.id || null,
    { pin } = chatHistory;
  useEffect(() => {
    pin(chatId);
    return () => pin(null);
  }, [chatId, pin]);
  useLayoutEffect(() => {
    if (!dock.current) return;
    const element = dock.current,
      content = element.closest<HTMLElement>('.content-shell')!,
      overview = element.closest<HTMLElement>('.project-overview')!,
      column = overview.querySelector<HTMLElement>('.overview-main');
    // Wide screens: under the left column, so the materials column stays clear.
    const align = () => {
      const wide =
          column &&
          column.getBoundingClientRect().width < overview.getBoundingClientRect().width - 100,
        box = (wide ? column : content).getBoundingClientRect();
      element.style.left = box.left + 'px';
      element.style.width = box.width + 'px';
      overview.style.paddingBottom =
        element.querySelector('.composer')!.getBoundingClientRect().height + 72 + 'px';
    };
    const observer = new ResizeObserver(align);
    observer.observe(content);
    observer.observe(element);
    window.addEventListener('resize', align);
    align();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', align);
      overview.style.paddingBottom = '';
    };
  }, []);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      clearInterval(timer);
      if (
        !motion.matches &&
        !document.hidden &&
        !hovered &&
        !focused &&
        !draft &&
        !typing &&
        available
      )
        timer = setInterval(() => setExample((i) => (i + 1) % projectQuestions.length), 6000);
    };
    refresh();
    motion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      motion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [hovered, focused, draft, typing, available]);
  useEffect(() => {
    if (!open) return;
    // Source panel and Gravity popups live outside the dock; clicks there keep the answer open.
    const outside = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!dock.current?.contains(t) && !t.closest?.('.source-panel,.g-popup,.g-dialog'))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.activeElement?.closest('.source-panel')) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const question = projectQuestions[example],
    shown = open && (messages.length > 0 || typing);
  const reopen = (target: EventTarget) => {
    if ((target as Element).tagName === 'TEXTAREA' && messages.length) setOpen(true);
  };
  const submit = async (text: string) => {
    setDraft('');
    setOpen(true);
    if (!(await askGlobal(text, projectId))) setDraft(text);
  };
  return (
    <section
      ref={dock}
      className="project-question"
      data-open={shown ? '' : undefined}
      aria-label="Вопрос по материалам проекта"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(e) => {
        setFocused(true);
        reopen(e.target);
      }}
      onClick={(e) => reopen(e.target)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="project-question-body">
        <div className="project-answer" role="region" aria-label="Ответ по проекту" inert={!shown}>
          <div className="project-answer-inner">
            <div className="project-answer-head">
              <span>Мнемодак · про этот проект</span>
              <IconButton
                icon={MessageSquare}
                label="Открыть в чате"
                size="m"
                disabled={!chatHistory.activeId && !chatId}
                onClick={() => chatId && go('conversation/' + chatId)}
              />
              <IconButton
                icon={Minimize2}
                label="Свернуть"
                size="m"
                onClick={() => setOpen(false)}
              />
            </div>
            <div className="project-answer-body">
              <ConversationLog label="Чат проекта" />
            </div>
          </div>
        </div>
        {globalError ? (
          <p className="form-error composer-help chat-error" role="alert">
            <Mascot mood={errorMood(globalError)} size={20} />
            {globalError}
          </p>
        ) : null}
        <ChatComposer
          value={draft}
          onChange={setDraft}
          loading={typing}
          available={available}
          inputLabel="Вопрос по исследованиям"
          sendLabel="Отправить вопрос"
          placeholder={question}
          suggestion={question}
          onSubmit={submit}
        />
        {!available ? (
          <p className="composer-help">
            Подключите модель в настройках проекта, чтобы задать вопрос.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ConversationLog({ label }: { label: string }) {
  const { chatHistory, globalMessages, globalTyping, notify, setAnswerRating, panel, setPanel } =
    useApp();
  const showSources = (list: ChatSource[], key: string) =>
    setPanel({ sources: list, heading: sourcesHeading(list), key });
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, [globalMessages.length, globalTyping]);
  return (
    <>
      {globalMessages.length ? (
        <div
          className="messages"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={label}
        >
          {globalMessages.map((m, mi) => (
            <article
              ref={m.id === chatHistory.latestReplyId ? revealMessage : undefined}
              className={
                'message ' +
                m.role +
                (m.id === chatHistory.latestReplyId ||
                (m.role === 'user' && globalTyping && mi === globalMessages.length - 1)
                  ? ' message-arrive'
                  : '')
              }
              key={m.id}
            >
              {m.role === 'user' ? (
                m.text
              ) : (
                <>
                  <AnswerText
                    id={m.id}
                    text={m.answer}
                    sources={m.sources}
                    onCite={showSources}
                    active={panel?.key}
                  />
                  {m.sources?.length ? (
                    <button
                      type="button"
                      className="answer-sources"
                      aria-expanded={panel?.key === m.id + '-all'}
                      onClick={() =>
                        setPanel({
                          sources: m.sources,
                          heading: 'Источники ответа',
                          key: m.id + '-all',
                        })
                      }
                    >
                      <Quote size={14} aria-hidden="true" />
                      {'Опирается на ' +
                        plural(materialCount(m.sources), 'материал', 'материала', 'материалов') +
                        (new Set(m.sources.map((x) => x.workspaceId)).size > 1
                          ? ' из ' +
                            plural(
                              new Set(m.sources.map((x) => x.workspaceId)).size,
                              'проекта',
                              'проектов',
                              'проектов',
                            )
                          : '')}
                    </button>
                  ) : null}
                  <div className="answer-sign">
                    <Mascot
                      mood={
                        m.rating === 'up'
                          ? 'love'
                          : m.rating === 'down'
                            ? 'shy'
                            : !m.sources?.length
                              ? 'puzzled'
                              : m.id === chatHistory.latestReplyId
                                ? 'happy'
                                : 'idle'
                      }
                      live={mi === globalMessages.length - 1 && !globalTyping}
                    />
                    Мнемодак
                  </div>
                  <AnswerActions
                    message={m}
                    notify={notify}
                    onRated={(rating) => setAnswerRating(m.id, rating)}
                  />
                </>
              )}
            </article>
          ))}
        </div>
      ) : null}
      {globalTyping ? <ThinkingIndicator /> : null}
      <div ref={bottom} />
    </>
  );
}

export function GlobalChat() {
  const {
    real,
    state,
    user,
    workspaces,
    chatHistory,
    globalMessages,
    globalTyping,
    globalError,
    askGlobal,
    openGlobalSource,
    notify,
    setAnswerRating,
    go,
  } = useApp();
  const [draft, setDraft] = useState(''),
    [context, setContext] = useState<any>({ loading: true }),
    [contextRetry, setContextRetry] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const ready = state.studies.filter((s) => s.status === 'ready').length;
  useEffect(() => {
    let active = true;
    if (!real) {
      setContext({ loading: false, materials: ready, model: 'Локальный пример' });
      return;
    }
    setContext((c) => ({ ...c, loading: true, error: '' }));
    api('/api/research-context', undefined, 'GET', false)
      .then((data) => {
        if (active) setContext({ ...data, loading: false });
      })
      .catch((e) => {
        if (active) setContext({ loading: false, error: e.message });
      });
    return () => {
      active = false;
    };
  }, [real, user?.id, workspaces.length, state.workspace?.id, ready, contextRetry]);
  const available =
    Boolean(context.model) && context.materials > 0 && !context.loading && !chatHistory.loading;
  const submit = async (question: string) => {
    setDraft('');
    if (!(await askGlobal(question))) setDraft(question);
  };
  const hasMessages = globalMessages.length > 0,
    project = workspaces.find(
      (w) => w.id === chatHistory.chats.find((c) => c.id === chatHistory.activeId)?.projectId,
    );
  return (
    <section
      className={'global-chat research-chat' + (hasMessages ? ' has-messages' : ' is-new')}
      aria-labelledby="global-chat-title"
    >
      <div className="chat-welcome">
        <Mascot
          mood={globalTyping ? 'thinking' : draft.trim() ? 'listening' : 'idle'}
          size={56}
          live
        />
        <h1 id="global-chat-title">Чем вам помочь?</h1>
      </div>
      {chatHistory.loading ? <p role="status">Открываем переписку…</p> : null}
      {project ? (
        <a className="chat-project-link" href={routeHref('home', project.id)}>
          <ArrowLeft size={16} aria-hidden="true" />
          Проект «{project.name}»
        </a>
      ) : null}
      <ConversationLog label="Общий чат" />
      <div className="research-chat-compose">
        {context.error ? (
          <div className="global-context-error">
            <p className="form-error" role="alert">
              {context.error}
            </p>
            <Button view="outlined" onClick={() => setContextRetry((n) => n + 1)}>
              Повторить проверку
            </Button>
          </div>
        ) : null}
        {globalError ? (
          <p className="form-error" role="alert">
            {globalError}
          </p>
        ) : null}
        <ChatComposer
          value={draft}
          onChange={setDraft}
          loading={globalTyping}
          available={available}
          inputLabel="Вопрос по всем исследованиям"
          sendLabel="Отправить вопрос по всем исследованиям"
          placeholder="Например, топ-5 проблем в чате Суточно.ру"
          suggestion="Топ-5 проблем в чате Суточно.ру"
          onSubmit={submit}
        />
        {!hasMessages && available ? (
          <div className="research-chat-suggestions">
            {[
              'Какие проблемы повторяются?',
              'Что мешает завершить бронирование?',
              'Что мы знаем о чате с хозяином?',
            ].map((question) => (
              <button
                key={question}
                type="button"
                disabled={globalTyping || !available}
                onClick={() => void submit(question)}
              >
                {question}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        ) : null}
        {!available && !context.error ? (
          <p className="composer-help" role="status">
            {context.loading ? (
              'Проверяем доступные исследования…'
            ) : !context.materials ? (
              <>
                <a href={appHref('research')}>Добавьте материалы</a> в проект и дождитесь
                расшифровки.
              </>
            ) : user?.owner ? (
              <>
                <a href={appHref('models')}>Подключите модель</a>, чтобы задать вопрос.
              </>
            ) : (
              'Попросите владельца проекта подключить модель.'
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
