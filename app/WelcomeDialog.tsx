import React, {useEffect, useRef, useState} from 'react';
import {Dialog} from '@gravity-ui/uikit';
import {Files, Lightbulb, MessageSquare} from 'lucide-react';
import Mascot from './Mascot.tsx';
import {api} from './api.ts';
import './welcome-dialog.css';

const features = [
  {Icon: Files, title: 'Материалы', description: 'Записи, расшифровки интервью и отчёты команды.'},
  {Icon: Lightbulb, title: 'Находки', description: 'Проблемы, инсайты и рекомендации с цитатами из исследований.'},
  {Icon: MessageSquare, title: 'Чат', description: 'Задавайте вопросы и переходите к источникам прямо из ответа.'},
];

export default function WelcomeDialog({pending, onExplore, returnFocus}: {
  pending: boolean;
  onExplore: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const open = pending && !dismissed;
  const title = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    // Gravity can move focus outside when the initial target is a static heading.
    const keepTabInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = title.current?.closest('[role="dialog"]');
      const close = dialog?.querySelector<HTMLButtonElement>('.g-dialog-btn-close__btn');
      const explore = dialog?.querySelector<HTMLButtonElement>('.g-dialog-footer__button-apply');
      if (!close || !explore) return;
      const active = document.activeElement;
      const next = !explore.disabled && (active === close || active !== explore && !event.shiftKey) ? explore : close;
      event.preventDefault();
      next.focus();
    };
    document.addEventListener('keydown', keepTabInside);
    return () => document.removeEventListener('keydown', keepTabInside);
  }, [open]);

  const dismiss = async (explore: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await api('/api/welcome/dismiss', undefined, 'POST', false);
    } catch {
      setError(true);
      return;
    } finally {
      setSaving(false);
    }
    setDismissed(true);
    if (explore) onExplore();
  };

  return (
    <Dialog open={open} onClose={() => void dismiss(false)} initialFocus={title}
      onTransitionOutComplete={() => {
        if (!document.querySelector('.g-modal_open')) returnFocus.current?.focus({preventScroll: true});
      }}
      maxWidth="s" fullWidth contentOverflow="auto" disableOutsideClick hasCloseButton
      className="welcome-dialog" aria-labelledby="welcome-heading" aria-describedby="welcome-lead">
      <Dialog.Header as="h2" caption={
        <span className="welcome-heading">
          <Mascot size={56}/>
          <span id="welcome-heading" tabIndex={-1} ref={title}>Добро пожаловать в Мнемодак</span>
        </span>
      }/>
      <Dialog.Body>
        <p className="welcome-lead" id="welcome-lead">База продуктовых исследований команды.</p>
        <ul className="welcome-features" role="list">
          {features.map(({Icon, title, description}) => (
            <li key={title}>
              <Icon size={20} aria-hidden="true"/>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ul>
        {error && <p className="form-error" role="alert">Не удалось сохранить. Попробуйте ещё раз.</p>}
      </Dialog.Body>
      <Dialog.Footer textButtonApply="Открыть проекты" propsButtonApply={{size: 'l'}} loading={saving}
        onClickButtonApply={() => void dismiss(true)}/>
    </Dialog>
  );
}
