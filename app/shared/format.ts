import type { Study, Segment } from '../types.ts';
import { transcript } from '../data.ts';
import { DEMO } from '../state/constants.ts';

export const uid = () => crypto.randomUUID();

export const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const materialDate = new Intl.DateTimeFormat('ru', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const plural = (n: number, one: string, few: string, many: string) => {
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = { one, few, many, other: many };
  return `${n} ${forms[new Intl.PluralRules('ru').select(n)]}`;
};

export const importanceTheme = (i?: string) =>
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

export const stamp = (ms: number | string) =>
  new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));

export const fullDate = (s: string) =>
  new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
    new Date(s + 'T12:00:00'),
  ) +
  ' ' +
  s.slice(0, 4);

// Documents without pages (TXT) have no timecode: show «Текст», not a misleading 0:00.
export const where = (seg?: Pick<Segment, 'page' | 'speaker' | 'time'> | null) =>
  seg?.page
    ? 'Стр. ' + seg.page
    : seg?.speaker === 'Документ' && !seg?.time
      ? 'Текст'
      : time(seg?.time || 0);

export const segmentsOf = (s?: Study | null): Segment[] =>
  s?.segments?.length ? s.segments : DEMO && s ? transcript : [];
