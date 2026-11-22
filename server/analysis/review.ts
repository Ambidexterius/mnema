import { randomUUID } from 'node:crypto';
import { text } from '../http.ts';
import type { Finding } from '../../app/types.ts';

// Stage 1 of the UX brief: findings are reviewed by a person; readers only ever receive verified ones.
export const findingStatuses = new Set(['draft', 'verified', 'rejected']);
export const importanceLevels = ['Критично', 'Высокая', 'Средняя', 'Низкая'];
const findingKinds = ['Проблема', 'Инсайт', 'Рекомендация', 'Цифра'];
const legacyKinds = {
  Наблюдение: 'Инсайт',
  Гипотеза: 'Инсайт',
  'Открытый вопрос': 'Инсайт',
  Решение: 'Рекомендация',
};
export const reportOf = (study) =>
  study?.report === 'ready' || study?.report === 'none'
    ? study.report
    : study?.type === 'Отчёт'
      ? 'ready'
      : 'none';
export const legacyFinding = (f) =>
  f.status
    ? f
    : {
        ...f,
        status: f.verified ? 'verified' : 'draft',
        importance: importanceLevels.includes(f.importance)
          ? f.importance
          : importanceLevels.includes(f.priority)
            ? f.priority
            : 'Средняя',
        kind: findingKinds.includes(f.kind) ? f.kind : legacyKinds[f.kind] || 'Инсайт',
        origin: f.origin || 'human',
        significant: Boolean(f.significant),
        history: Array.isArray(f.history) ? f.history : [],
      };
const historyAction = (prev, next) =>
  !prev
    ? next.origin === 'ai'
      ? 'suggested'
      : 'created'
    : prev.status !== next.status
      ? {
          verified: prev.status === 'draft' ? 'accepted' : 'restored',
          rejected: 'rejected',
          draft: 'reopened',
        }[next.status]
      : prev.title !== next.title ||
          prev.description !== next.description ||
          prev.kind !== next.kind ||
          prev.importance !== next.importance ||
          prev.significant !== next.significant
        ? 'edited'
        : null;
// Further evidence fragments of a finding: up to 8 distinct segment ids besides the main one.
const evidenceOf = (f: any, base: any): string[] =>
  [
    ...new Set<string>(
      (Array.isArray(f.evidence) ? f.evidence : base?.evidence || []).filter(
        (id: unknown): id is string =>
          typeof id === 'string' && id.length <= 120 && id !== f.segmentId,
      ),
    ),
  ].slice(0, 8);
// The model's reason explains its importance; once a person changes the importance the old reason no longer applies.
const reasonOf = (f: any, base: any): string =>
  typeof f.reason === 'string'
    ? f.reason.trim().slice(0, 240)
    : base?.reason && (!f.importance || f.importance === base.importance)
      ? base.reason
      : '';
export function reviewFinding(f: any, prev: any, person: { name: string }, now: number): Finding {
  const base = prev ? legacyFinding(prev) : null;
  const next: Finding = {
    id: text(f.id, 80) || randomUUID(),
    studyId: f.studyId,
    segmentId: f.segmentId,
    title: text(f.title, 160),
    description: String(f.description || '')
      .trim()
      .slice(0, base?.importSource ? 28000 : 4000),
    kind: findingKinds.includes(f.kind) ? f.kind : legacyKinds[f.kind] || base?.kind || 'Инсайт',
    importance: importanceLevels.includes(f.importance)
      ? f.importance
      : importanceLevels.includes(f.priority)
        ? f.priority
        : base?.importance || 'Средняя',
    significant: Boolean(f.significant),
    origin: base?.origin || 'human',
    ...(evidenceOf(f, base).length ? { evidence: evidenceOf(f, base) } : {}),
    ...(reasonOf(f, base) ? { reason: reasonOf(f, base) } : {}),
    // A person who creates a finding has reviewed it; AI drafts are only created by the server.
    status: base ? (findingStatuses.has(f.status) ? f.status : base.status) : 'verified',
    ...(base?.importSource ? { importSource: base.importSource } : {}),
    createdAt: base?.createdAt || now,
    createdBy: base?.createdBy || person.name,
    history: [...(base?.history || [])].slice(-49),
  };
  const action = historyAction(base, next);
  if (action) next.history.push({ action, status: next.status, by: person.name, at: now });
  return next;
}
