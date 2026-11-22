import type { Study, Segment } from '../types.ts';
import { transcript } from '../data.ts';
import { DEMO } from '../state/constants.ts';

export const uid = () => crypto.randomUUID();

export const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const materialDate = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const plural = (n, one, few, many) =>
  `${n} ${{ one, few, many, other: many }[new Intl.PluralRules('ru').select(n)]}`;

export const importanceTheme = (i) =>
  i === 'Критично' ? 'danger' : i === 'Высокая' ? 'warning' : 'normal';

export const actionLabel = {
  created: 'создал(а)',
  suggested: 'предложил(а)',
  accepted: 'принял(а)',
  rejected: 'отклонил(а)',
  restored: 'вернул(а) в проверенные',
  reopened: 'вернул(а) на проверку',
  edited: 'изменил(а)',
};

export const stamp = (ms) =>
  new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));

export const fullDate = (s) =>
  new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
    new Date(s + 'T12:00:00'),
  ) +
  ' ' +
  s.slice(0, 4);

// Documents without pages (TXT) have no timecode: show «Текст», not a misleading 0:00.
export const where = (seg) =>
  seg?.page
    ? 'Стр. ' + seg.page
    : seg?.speaker === 'Документ' && !seg?.time
      ? 'Текст'
      : time(seg?.time || 0);

const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const segmentsOf = (s?: Study | null): Segment[] =>
  s?.segments?.length ? s.segments : DEMO && s ? transcript : [];
