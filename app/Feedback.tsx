import React, {useEffect, useRef, useState} from 'react';
import {Button, Popup, Select, TextArea, ThemeProvider} from '@gravity-ui/uikit';
import {ArrowRight, ScanLine, X} from 'lucide-react';
import {api} from './api.ts';
import {IdeaPublishedDialog} from './Ideas.tsx';
import {feedbackCategories, feedbackElements, feedbackPages, isFeedbackPath, type FeedbackContext} from './feedback-context.ts';
import {captureFeedbackAnchor, namedFeedbackAnchor} from './feedback-anchor.ts';
import './feedback-mode.css';

const targetTypes: [string, FeedbackContext['element']][] = [
  ['.shared-composer', 'composer'], ['.breadcrumbs', 'breadcrumbs'],
  ['.message.assistant,.project-answer', 'answer'], ['.project-catalog-card,.project-card', 'card'],
  ['tr,[role="row"]', 'row'], ['[role="tablist"],.g-segmented-radio-group', 'tabs'],
  ['h1,h2,h3,h4', 'heading'], ['input,textarea,select,[contenteditable]', 'field'],
  ['button,[role="button"]', 'button'], ['a[href]', 'link'], ['.sidebar', 'navigation'],
  ['p,li,section,article,figure,video,img', 'block'],
];

function feedbackTarget(event: Event) {
  const origin = event.target;
  if (!(origin instanceof Element) || !origin.closest('.app-shell') ||
      origin.closest('[data-feedback-ui],[aria-hidden="true"].topbar')) return null;
  const named = namedFeedbackAnchor(origin);
  if (named) return {anchor: named.node, element: named.element, label: named.label};
  for (const [selector, element] of targetTypes) {
    const anchor = origin.closest(selector);
    if (anchor instanceof HTMLElement && anchor.getClientRects().length) return {anchor, element};
  }
  const anchor = origin.closest<HTMLElement>('#main');
  return anchor ? {anchor, element: 'page' as const} : null;
}

export function FeedbackMode({route, onClose, onIdeas}: {route: string; onClose: () => void; onIdeas: () => void}) {
  const [target, setTarget] = useState<ReturnType<typeof feedbackTarget>>(null);
  const [wholePage, setWholePage] = useState(false);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<FeedbackContext['category']>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const toolbar = useRef<HTMLElement>(null);
  const outline = useRef<HTMLDivElement>(null);
  const screen = route.split(/[/?]/)[0];
  const page = screen === 'conversation' ? 'chat' : screen === 'all-findings' ? 'findings' : Object.hasOwn(feedbackPages, screen)
    ? screen as FeedbackContext['page'] : 'page';
  const element = wholePage ? 'page' : target?.element;

  function clearTarget() {
    if (busy) return;
    setTarget(null);
    setWholePage(false);
    setError('');
    toolbar.current?.focus({preventScroll: true});
  }

  useEffect(() => {
    toolbar.current?.focus({preventScroll: true});
  }, []);

  useEffect(() => {
    if (sent) return;
    let hovered: HTMLElement | undefined;
    const positionOutline = () => {
      const layer = outline.current;
      const anchor = wholePage ? undefined : target?.anchor || hovered;
      if (!layer) return;
      if (!anchor?.isConnected) {layer.hidden = true; return;}
      const rect = anchor.getBoundingClientRect();
      const scrollArea = anchor.closest('.content-shell,.sidebar')?.getBoundingClientRect();
      const left = Math.max(0, scrollArea?.left ?? 0, rect.left - 2);
      const top = Math.max(0, scrollArea?.top ?? 0, rect.top - 2);
      const right = Math.min(innerWidth, scrollArea?.right ?? innerWidth, rect.right + 2);
      const bottom = Math.min(innerHeight, scrollArea?.bottom ?? innerHeight, rect.bottom + 2);
      layer.hidden = right <= left || bottom <= top || !rect.width || !rect.height;
      if (layer.hidden) return;
      Object.assign(layer.style, {transform: `translate(${left}px, ${top}px)`, width: `${right - left}px`, height: `${bottom - top}px`});
    };
    const observer = new ResizeObserver(positionOutline);
    const highlight = (next?: HTMLElement) => {
      if (hovered === next) return;
      observer.disconnect();
      hovered = next;
      if (hovered) observer.observe(hovered);
      positionOutline();
    };
    const preview = (event: Event) => {
      if (!target && !(event instanceof PointerEvent && event.pointerType === 'touch')) highlight(feedbackTarget(event)?.anchor);
    };
    const stopPreview = () => {if (!target) highlight();};
    const pick = (event: Event) => {
      const next = feedbackTarget(event);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      if (!target) setTarget(next);
    };
    const key = (event: KeyboardEvent) => {
      if (!target && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (!event.isComposing && (event.key === 'Enter' || event.key === ' ')) pick(event);
    };
    if (target) observer.observe(target.anchor);
    positionOutline();
    window.addEventListener('pointermove', preview, true);
    document.documentElement.addEventListener('pointerleave', stopPreview);
    window.addEventListener('focusin', preview, true);
    window.addEventListener('click', pick, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', positionOutline, true);
    window.addEventListener('resize', positionOutline);
    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', preview, true);
      document.documentElement.removeEventListener('pointerleave', stopPreview);
      window.removeEventListener('focusin', preview, true);
      window.removeEventListener('click', pick, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', positionOutline, true);
      window.removeEventListener('resize', positionOutline);
    };
  }, [target, wholePage, sent, onClose]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || !element || busy || text.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      const path = window.location.pathname;
      const feedback: FeedbackContext = {page, element, category};
      if (isFeedbackPath(path)) feedback.location = element === 'page' ? {path} : {path, ...await captureFeedbackAnchor(target.anchor)};
      await api('/api/ideas', {text, feedback}, 'POST', false);
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <IdeaPublishedDialog onClose={onClose} onIdeas={onIdeas}/>;

  return <>
    <div className="feedback-outline" aria-hidden="true" ref={outline} hidden data-selected={Boolean(target) || undefined}/>
    <ThemeProvider theme="dark" rootClassName="feedback-layer">
      <aside className="feedback-mode" ref={toolbar} tabIndex={-1} aria-labelledby="feedback-mode-title" data-feedback-ui data-composing={Boolean(target) || undefined}>
        <div className="feedback-mode-head">
          <strong id="feedback-mode-title">Обратная связь</strong>
          <Button view="flat" size="l" aria-label="Выйти из режима обратной связи" disabled={busy} onClick={onClose}><X size={18}/></Button>
        </div>
        <p>Выберите элемент, чтобы оставить отзыв. <span className="feedback-mode-keyboard">С клавиатуры используйте Tab и Enter.</span></p>
        <Button view="outlined" size="l" width="max" disabled={busy} onClick={onIdeas}>Мои идеи</Button>
      </aside>
    </ThemeProvider>
    {target && <ThemeProvider theme="light" rootClassName="feedback-layer">
      <Popup open anchorElement={target.anchor} className="feedback-composer-popup" placement={['bottom-start', 'top-start', 'right-start', 'left-start']}
        offset={8} zIndex={100} disableOutsideClick disableFocusOut returnFocus={false}
        onOpenChange={open => {if (!open) clearTarget();}}>
        <form className="feedback-composer" role="dialog" aria-label={element === 'page' ? 'Отзыв о странице' : 'Отзыв об элементе'} data-feedback-ui onSubmit={send}>
          <div className="feedback-composer-head">
            <span><ScanLine size={16} aria-hidden="true"/>{element === 'page' ? feedbackElements.page : target.label || feedbackElements[target.element]}</span>
            <div className="feedback-composer-target-actions">
              {element !== 'page' && <Button view="flat" size="m" disabled={busy} onClick={()=>setWholePage(true)}>Вся страница</Button>}
              <Button view="flat" size="l" aria-label="Выбрать другой элемент" disabled={busy} onClick={clearTarget}><X size={16}/></Button>
            </div>
          </div>
          <TextArea value={text} onUpdate={setText} minRows={2} maxRows={5} disabled={busy} autoFocus
            placeholder="Что можно улучшить?" controlProps={{'aria-label': 'Отзыв', maxLength: 2000}}/>
          <p className="feedback-hint">Коллеги увидят отзыв в портале идей</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="feedback-composer-actions">
            <Select size="l" placeholder="Категория" aria-label="Категория отзыва (необязательно)" hasClear
              disabled={busy} value={category ? [category] : []}
              onUpdate={value => setCategory(value[0] as FeedbackContext['category'])}
              options={Object.entries(feedbackCategories).map(([value, content]) => ({value, content}))}/>
            <Button type="submit" view="action" size="l" loading={busy} disabled={text.trim().length < 3}
              aria-label="Отправить отзыв"><ArrowRight size={18} aria-hidden="true"/></Button>
          </div>
        </form>
      </Popup>
    </ThemeProvider>}
  </>;
}
