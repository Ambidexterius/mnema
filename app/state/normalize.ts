import type { Finding, Study } from '../types.ts';

const legacyKinds: Partial<Record<string, Finding['kind']>> = {
  Наблюдение: 'Инсайт',
  Гипотеза: 'Инсайт',
  'Открытый вопрос': 'Инсайт',
  Решение: 'Рекомендация',
};

export const normalize = (
  f: Finding & { verified?: boolean; priority?: Finding['importance'] },
): Finding =>
  f.status
    ? f
    : {
        ...f,
        status: f.verified ? 'verified' : 'draft',
        importance: f.importance || f.priority || 'Средняя',
        kind: legacyKinds[f.kind] || f.kind || 'Инсайт',
        origin: f.origin || 'human',
        history: f.history || [],
      };

export const reportOf = (s?: Pick<Study, 'report' | 'type'> | null) =>
  s?.report === 'ready' || s?.report === 'none' ? s.report : s?.type === 'Отчёт' ? 'ready' : 'none';
