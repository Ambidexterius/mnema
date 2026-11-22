import {
  initialStudies,
  initialFindings,
  initialModels,
  initialProcessors,
  initialUsers,
} from '../data.ts';

export const DEMO = import.meta.env.VITE_DEMO === 'true';

export const qa = DEMO && new URLSearchParams(location.search).get('qa') === '1';

export const storage = qa ? 'ai-hyposut.qa.v1' : 'ai-hyposut.demo.v1';

const defaults = {
  studies: initialStudies,
  findings: initialFindings,
  models: initialModels,
  processors: initialProcessors,
  users: initialUsers,
  modelId: 'deepseek',
  theme: 'dark',
  sidebarCollapsed: false,
  soundEnabled: true,
  messages: [],
};

// Stage 1 of the UX brief: review statuses, one importance scale, source basis.
export const KINDS = ['Проблема', 'Инсайт', 'Рекомендация', 'Цифра'];

export const IMPORTANCE = ['Критично', 'Высокая', 'Средняя', 'Низкая'];

export const importanceOrder = Object.fromEntries(IMPORTANCE.map((x, i) => [x, i]));

export function load() {
  try {
    const v = JSON.parse(localStorage.getItem(storage));
    const local = v?.version === 1 ? v.data : {};
    return DEMO
      ? { ...structuredClone(defaults), ...local }
      : {
          ...structuredClone(defaults),
          studies: [],
          findings: [],
          users: [],
          models: [],
          processors: [],
          messages: [],
          theme: local.theme || 'light',
          sidebarCollapsed: !!local.sidebarCollapsed,
          soundEnabled: local.soundEnabled !== false,
        };
  } catch {
    return DEMO
      ? structuredClone(defaults)
      : {
          ...structuredClone(defaults),
          studies: [],
          findings: [],
          users: [],
          models: [],
          processors: [],
          messages: [],
          theme: 'light',
        };
  }
}
