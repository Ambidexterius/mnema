export const feedbackPages = {
  chat: 'Чат',
  research: 'Проекты',
  home: 'Обзор проекта',
  library: 'Материалы',
  findings: 'Находки',
  study: 'Материал',
  finding: 'Находка',
  page: 'Страница',
} as const;

export const feedbackElements = {
  page: 'Вся страница',
  navigation: 'Меню',
  breadcrumbs: 'Хлебные крошки',
  heading: 'Заголовок',
  composer: 'Поле чата',
  answer: 'Ответ',
  card: 'Карточка проекта',
  row: 'Строка таблицы',
  tabs: 'Вкладки',
  button: 'Кнопка',
  link: 'Ссылка',
  field: 'Поле',
  block: 'Блок',
} as const;

export const feedbackCategories = {
  accessibility: 'Доступность',
  content: 'Текст и содержание',
  design: 'Внешний вид',
  bug: 'Ошибка',
} as const;

const feedbackPath =
  /^\/(?:chat|projects|all-findings|conversation\/[\w-]{1,128}|projects\/[\w-]{1,128}(?:\/(?:research|findings|(?:studies|findings)\/[\w-]{1,128}))?)$/;

export function isFeedbackPath(path: unknown): path is string {
  return typeof path === 'string' && path.trim() === path && feedbackPath.test(path);
}

export type FeedbackLocation = {
  path: string;
  anchor?: string;
  label?: string;
};

export type FeedbackContext = {
  page: keyof typeof feedbackPages;
  element: keyof typeof feedbackElements;
  category?: keyof typeof feedbackCategories;
  location?: FeedbackLocation;
};
