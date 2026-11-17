## 0.10.1 — 17 ноября 2026

Номер 1.0.0 был присвоен рано: продукт остаётся бета-версией, нумерация продолжается с 0.10.1. Выпуск 1.0.0 ниже сохранён в истории как есть.

Вход и регистрация собраны на штатных компонентах Gravity UI. Ошибка показывается под тем полем, где она возникла, а не над кнопкой. Пароль вводится в Gravity PasswordInput. После неверного входа курсор возвращается в поле пароля. Отступы одинаковы на входе и на всех шагах регистрации: подпись → поле 8 px, поле → ошибка 4 px, между полями 16 px. Текст ошибки в тёмной теме стал контрастнее: 7,86:1 вместо 4,41:1.

На компьютере крошки и содержимое страницы начинаются с одной линии, у чата те же поля, что у остальных разделов. На телефоне кнопки и вкладки используют размер Gravity l (36 px). Значок меню и стрелка возврата стоят на линии содержимого. Название документа и подпись под ним идут без лишнего зазора. Настройки открываются на весь экран с подписанными разделами. Боковое меню в тёмной теме отделено от страницы. Поле поиска по тексту не увеличивает страницу в iOS Safari.

Ввод кода из письма и его анимация не менялись.

Добавлено восстановление пароля. На входе появилась ссылка «Забыли пароль?»: почта, код из письма, новый пароль — и вы сразу в Мнемонике. Прежние сессии завершаются, на почту приходит уведомление о смене пароля.

Продукт переименован в «Мнемодак»: новое название в интерфейсе, заголовке вкладки и письмах. На экране входа знак стоит ровно по центру, а значок беты перенесён к заголовку «Вход в Мнемодак».

Новый обзор проекта. Под названием — вкладки «Обзор / Находки / Материалы» со счётчиками, паспорт проекта не менялся. Слева «Кратко»: главные выводы со ссылками на источники, их собирает модель проекта по проверенным находкам, и вопросы для чата. Ниже — находки с фильтром по типу и шкалой повторяемости. Справа — материалы с иконками, статусом обработки и скачиванием каждого файла или всех одним архивом. В верхней панели — ссылка на проект и меню проекта.

Вкладки проекта сохраняют название проекта в заголовке. В обзоре — до восьми материалов, «Все материалы» рядом с заголовком; «Все находки» оформлено такой же ссылкой. Кнопка «Добавить файл» под заголовком занимает всю ширину колонки. Названия файлов — одна строка с многоточием; на компьютере системная подсказка и прокрутка при наведении, на телефоне только обрезка.

Над названием проекта на всех вкладках появилась ссылка «Назад» со стрелкой. Она возвращает на предыдущую страницу, а при прямом открытии проекта — в «Проекты».

Исправлен скачок заголовка при открытии проекта: «Назад» находится в верхней панели, заголовки каталога и вкладок проекта стоят на одной высоте на компьютере и телефоне.

## 1.0.0 — 17 ноября 2026

На телефоне находки и материалы открываются списком. Интервью, текст документа и сводку можно читать отдельно, переходить к цитатам и возвращаться в исходный список. В мобильном обзоре проекта появились вкладка «Документы» и блок «Материалы». Команды C/T и отправка по Enter доступны на компьютере. Исправлены регистрация по приглашению при включённой корпоративной регистрации и сохранение почты для автозаполнения Safari.

## 0.9.47 — 2026-11-16


- Текстовые ссылки снова выглядят как текст: в покое цвет основного текста без подчёркивания, при наведении — красный. Постоянно красные подчёркнутые ссылки из 0.9.43-регистрации отменены по жалобе пользователей.

## 0.9.46 — 2026-11-16

- Резервная модель: если выбранная модель перегружена или недоступна (429, 5xx, 529, таймаут), тот же запрос выполняет модель с отметкой «Резервная». Упавшая модель пропускается 10 минут, затем снова пробуется первой. Ошибки ключа и оплаты (401/402/403) не переключаются. Работает для чатов, сводок и находок.
- Под ответом и в оценке ответа указана модель, которая ответила фактически. «Проверить подключение» проверяет только выбранную модель.
- В настройках модели — отметка «Резервная модель» с пояснением, в списке — метка «Резервная». Резервной может быть только одна модель.
- Схема данных и зависимости не менялись.

## 0.9.45 — 2026-11-16

- Вход и регистрация: однотонный фон, компактный знак, один заголовок действия и внешние подписи полей. Сохранён полный флоу подтверждения почты, пароля и профиля с фото.
- Заливка основных кнопок немного темнее в той же фирменной красной оси: #E01E48, белый текст 4,72:1. Знак и исходный брендовый #EE204D сохранены.
- Предыдущие изменения ответов чата из 0.9.44 сохранены. Зависимости и схема данных не менялись.

## 0.9.44 — 2026-11-16

- Ответ в чате с разделами собирается как короткий отчёт: первый абзац — блок «Главное», заголовки тем — тихие подписи, пункт начинается с жирного тезиса, «Выводы» и «Что осталось невыясненным» — тонированные карточки (в тёмной теме приглушённые). Короткие ответы остаются простым текстом.
- Если во фрагментах есть явные числа, модель добавляет раздел «Цифры»; он показывается карточками «что измерено — число — источник», по две в ряд, на телефоне в одну колонку. Числа берутся только из фрагментов.
- Промпт: тезис жирным в начале пункта и необязательный раздел «Цифры». Печать выделяет тезисы жирным.
- Схема данных и зависимости не менялись.

## 0.9.43 — 2026-11-16

## 0.9.43 — регистрация сотрудников, 16.11.2026

Обновление без повышения номера версии. Свободная регистрация для подтверждённых адресов @sutochno.ru: код из письма, пароль минимум 8 символов, имя/фамилия и необязательное фото. Новым сотрудникам доступны все проекты с полным доступом к материалам; права управления пользователями автоматически не выдаются. Фотографии проверяются сервером и сохраняются без метаданных. Единый красный стиль текстовых ссылок. Тестовый фиксированный код заблокирован в production.



- У своей идеи вместо карандаша кнопка «⋯» с пунктами «Редактировать» и «Удалить». Удалить, как и изменить, можно в течение 24 часов с отправки; после подтверждения идея удаляется вместе с голосами и комментариями. Автора и срок проверяет сервер.
- Строка списка идей, сама идея и комментарии оформлены одинаково: аватар, имя, метка, время, текст. У комментариев метки «Автор идеи» и «Администратор», время в пределах суток относительное, реплики одного человека подряд собираются в один блок, в заголовке «Комментарии · N», поле комментария прилипает к низу.
- C и T работают всегда, переключатель «Горячие клавиши» из профиля убран (уже было на сервере после 0.9.42).
- Схема данных и зависимости не менялись.

## 0.9.42 — 2026-11-16

- Верхняя панель 44 px без нижней линии; логотип, кнопка меню и крошки выровнены. Верхний отступ контента 24 px на десктопе, меню компактнее.
- Убраны надписи «Знания команды» и «Доказательства и выводы»; история называется «Чаты».
- Отчёты показываются первыми в обеих таблицах исследований. Тип остаётся в своей колонке, без дублирующей метки.
- C открывает форму нового проекта, T — новый чат с фокусом в поле вопроса. Одиночные клавиши работают в русской раскладке и не перехватывают ввод, IME, автоповтор и сочетания браузера. В профиле есть сохраняемый выключатель.
- Подсказки Gravity Hotkey рядом с «Создать», «Проекты» и «Новый чат»; тултипы с названием действия и плашкой клавиши в обеих темах.
- Свои идеи можно редактировать в течение 24 часов с отправки. После суток карандаш отключён и показывает пояснение. Сервер проверяет автора и срок; голоса, комментарии, статус и исходная дата сохраняются.
- В шапке идеи первая строка текста с многоточием при переполнении. Комментарии показывают аватар, автора, дату и время; текст отделён от метаданных.
- Начальная загрузка по центру, 16 px, со штатным индикатором и поддержкой reduced motion.
- Новые серверные и браузерные проверки. Схема данных и зависимости не менялись.

## 0.9.41 — 2026-11-16

- Единая дизайн-система: DESIGN.md, обязательные инструкции AGENTS.md / CLAUDE.md / GEMINI.md и браузерная проверка в CI. Светлая тема и фирменный красный сохранены, тёмные поверхности сверены с приложением Linear; типографика общая.
- Каталог: заголовок «Проект», кнопка «Создать» в одном ряду; на телефоне папки занимают всю ширину. Меню открывается боковой шторкой с удержанием и возвратом фокуса; сворачивание на десктопе плавное и учитывает reduced motion.
- Настройки и обратная связь: выравнивание, пояснения 14 px, кнопка «Добавить», короткие тексты; «Как оцениваете сервис?», переход в портал идей по центру. Вторичные действия портала не конкурируют с primary; поиск использует токены дизайн-системы, ошибка новой идеи видна внутри формы.
- Находки сохраняют исходный контекст списка при переходе к материалу и назад; крошки с лампочкой. Ссылка на проект находится в блоке «Материал».
- Граница прокрутки длинной истории чатов, единое выравнивание статуса в таблицах, размер исходного файла и сохранённое скачивание.
- Сервер: повторная проверка доступа после чтения тела запроса; отсутствующий или повреждённый исходник возвращает ошибку без остановки процесса. Новые регрессионные тесты.
- Production dependencies не менялись. Playwright Core добавлен только для dev/CI-проверок; исследования и секреты не включены в репозиторий.

## 0.9.40 — 2026-11-15

- Ideas portal empty states: every empty tab and an empty search show an icon, a title and a short explanation. «Голосование», «Мои идеи» and search also offer «Предложить идею»; from search the query becomes the draft. No server or dependency changes.

## 0.9.39 — 2026-11-15

- «Обратная связь» at the bottom of the menu: «Как вам Мнемоника?» with 👍/👎 cards. 👍 is saved and shows a thank-you screen leading to «Открыть портал идей»; 👎 asks «Что улучшить?» and publishes the answer as an idea.
- «Портал идей» side sheet (also in the profile menu and at `/chat#ideas`): search across ideas, tabs «Голосование», «В работе», «Сделали», «Мои идеи», one vote per person, comments in the chat composer. The owner sets the status, gives a mandatory reason when declining and can hide an idea.
- Email: the owner gets every new idea; the author and voters get one message when an idea is done or declined. No mail for intermediate statuses.
- New SQLite tables `mnema_ideas`, `mnema_idea_votes`, `mnema_idea_comments`, `mnema_interface_ratings`; API `/api/ideas`, `/api/ideas/:id/vote|comments|status`, `/api/interface-rating`. All popups use the 24 px corner radius of settings. No dependency changes.

## 0.9.38 — 2026-11-15

- Answer citations show who said it instead of a number: a neutral chip «❝ Респондент 1» named after the material (the last « · » part, shortened). The number read as "how often the problem occurred", so it is gone, along with the blue/yellow colour coding and the lightbulb.
- Adjacent citations such as [1][2] [3] become one chip «Анна +2», where +N counts the other materials.
- A chip opens the side panel in a new list mode: quotes grouped by material with speaker, time or page, project and «Открыть фрагмент», which switches to the existing detailed view. The clicked chip stays highlighted.
- Under each answer «Опирается на N материалов (из M проектов)» opens every quote of the answer.
- The detailed source view no longer shows «Источник [N]». On touch screens the chip stays 20 px in the text line with a 44 px tap area. No server or dependency changes.

## 0.9.37 — 2026-11-15

- Settings get «Оценки ответов» for administrators who manage users: every 👍/👎 on chat answers with the question, who rated it and when, the project, and on expand the model's answer, its source materials and the model. Filter «Неполезные» (default), «Полезные», «Все»; latest 200 ratings.
- `GET /api/chat/feedback` returns the list to the owner and user managers only (403 for others); signatures, build and author grants are not included. Tests cover the list content and the access rule.
- Ratings still do not change answers or reach the model provider; the section is for reviewing where answers go wrong. No dependency changes.

## 0.9.36 — 2026-11-15

- The agent has 13 emotions with brows, mouth and blush: idle, listening, thinking, happy, wink, love, surprised, shy, puzzled, sad, angry, dizzy and sleepy, each with its own 3D pose and motion.
- Reactions: 👍 makes it fall in love, 👎 makes it shy; errors read differently (exhausted limit → sleepy, provider refusal → angry, lost connection or timeout → dizzy, others → sad). Anger is never aimed at the user.
- A live agent follows the pointer with its eyes (hover devices), dozes off after 45 s without input and startles awake, and giggles with love eyes when clicked. Random rest moments now include a wink and surprise.
- Dark theme: like the white logo, the agent turns soft milk-white with a warm grey side; brand red stays as the accent (hearts). Agent colours are theme variables.
- Smooth transitions: faces cross-fade (in 280 ms, out 180 ms), mood poses ease over 450 ms, sway and glance run on their own layers so emotions never cut them, and looping animations start after the pose settles.
- Under reduced motion there are no random moments, no gaze and no cross-fade overlap. No server or dependency changes.

## 0.9.35 — 2026-11-15

- The agent under the latest answer no longer freezes: the joy of a new answer lasts 2.6 s, then it rests alive (sway, breath, blink, glance, logo split). Every 8–14 s a live agent shows a short emotion for about 2 s: a smile with a hop, a puzzled tilt or a look down at the composer. A puzzled agent (nothing found) keeps its meaning and also blinks and glances.
- Fix: the glance keyframes lost in 0.9.34 are back, so the resting agent looks around again.
- Random emotions are off under reduced motion. No server or dependency changes.

## 0.9.34 — 2026-11-15

- Mnemonika's agent: the brand mark extruded into a small 3D character (stacked SVG slices in CSS `preserve-3d`, the logo on its back). It stands above the empty chat, looks at the composer while you type, sways and turns to show the logo while an answer is prepared, hops when an answer with sources arrives, tilts when nothing was found and slumps on an error. A small agent signs every answer «Мнемоника».
- The waiting line shows rotating steps («Читаю вопрос», «Ищу в исследованиях», «Сверяю цитаты»…) with a sweeping highlight and an elapsed timer (seconds, then minutes). Steps follow time, not server progress. Screen readers hear «Готовлю ответ» once.
- The empty chat heading is «Чем вам помочь?».
- All motion stops under reduced motion; the text status always stays. No server or dependency changes.

## 0.9.33 — 2026-11-15

- MCP bot tokens are issued for one year instead of 30 days. Tokens issued earlier keep their expiry date. OAuth connections are unchanged.
- The project picker in «Токен для бота» and on the MCP consent page has «Все проекты»: one click selects or clears every project available now; a partial choice shows a dash. Projects created later are not added to an existing token.

## 0.9.32 — 2026-11-15

- Settings open as a dialog over the current page instead of a separate page: section rail on the left (icon rail on phones), title and close button pinned while the content scrolls. Escape, outside click or browser «Назад» close it, and focus returns to «Настройки». Each section keeps its own address (`/models`, `/integrations`, `/mcp`, `/users`); switching sections replaces the address, so one «Назад» closes the dialog. Built on Gravity UI `Modal`; works in both themes and at 375 px.
- Models, processors, storage and integrations use grouped rows: status dot, switch and a «…» menu with «Проверить подключение», «Настроить» and «Удалить» instead of three buttons in a row. «Добавить модель» is the last row of the group.
- MCP shows who is connected: person, assistant, projects, last use, OAuth or token with expiry, and a green dot for use in the last 7 days. Your own connections can be revoked from the «…» menu.
- `/api/mcp/settings` returns `team` (active connections of all active members) to administrators only. Token values and hashes are never included. Tests cover both rules.
- Removed 37 unused CSS selectors of the old settings and MCP pages.

## 0.9.31 — 2026-11-14

- «Назад» on the project findings list and on the project research list now returns to the previous screen, like a single finding does. Opened from a direct link, it leads to the project overview instead of the list of all projects.
- Fix: file download now applies the same reader filter as the preview. A reader who knows the id of a hidden catalog file gets 404.
- Fix: when the administrator lowers a user's role, the user's own projects follow the new role: no drafts, no editing, no project settings. Widening access to all projects still keeps a creator's full role in their own projects. The administrator can now change a creator's access inside a single project.
- Tests for both access fixes; they fail on 0.9.30.

## 0.9.30 — 2026-11-14

- Restore the centered 1104 px content grid that 0.9.29 removed by mistake. Wide screens no longer stretch pages, and the home chat is centered again. Equal page padding from 0.9.29 is kept.

## 0.9.29 — 2026-11-14

- Make the project overview chat a real saved conversation. The first question creates a chat bound to the project; it appears in recent chats, opens full screen with «Открыть в чате» and links back to the project. Project chats answer from their own project first and widen to every accessible project only when the project has no evidence.
- Add an optional `project_id` to saved chats (created automatically on existing databases). Binding requires access to the project, and the chat disappears once that access is gone.
- Open the floating answer as one card above the composer: smooth open and collapse, click outside or Escape to collapse, citations still open in the side panel. Remove the old in-memory project chat and its temporary page.
- Show project details as Obsidian-style properties: click to edit, Enter saves, Escape cancels; month and year picker for «Проведено»; Gravity UI labels for tags and the report status. Add optional profile `tags` (up to 20, 40 characters each); older clients keep saved tags.
- On phones show three key properties with «Все свойства», 44 px touch targets and 16 px text.
- Rename the AI suggestion status from «Черновик ИИ» to «Предложено ИИ». Show material repeat counts on overview findings; rename «Все находки» to «Весь список».
- Equal page padding on every side; «Назад» on a finding returns to the previous screen. The floating composer is easier to see in both themes.

## 0.9.28 — 2026-11-14

- Float the project composer at the bottom center of the available content, accounting for the sidebar, source panel and long input.
- Rotate example questions every six seconds, pausing during interaction, input, generation, hidden tabs and reduced motion. Keep only the send arrow.
- Hide project chat until at least one material has ready, nonempty extracted text.
- Place overview findings on separate neutral Gravity UI surfaces, retaining their metadata and links.
- Preserve the 0.9.27 server, shared composer, branding and dependency declarations. GitHub-only release; no Selectel or Amvera deployment.

## 0.9.27 — 2026-11-13

- Wait for the server result before confirming finding edits, review actions, model removal or access changes. Keep the form and draft when saving fails.
- Share finding status labels across project views, the global catalog and material panels. Imported and human drafts say «Ждёт проверки»; only AI drafts say «Черновик ИИ».
- Remove 107 declarations overridden by the same selector/property/condition, preserving the active cascade and component styling.
- Validation: typecheck, 148 tests, production build; 123 browser checks on synthetic data, including delayed saves, 409 retries, network failures and CSS comparison. No runtime dependency changes.

## 0.9.26 — 2026-11-13

- Make Users a global directory, independent of the last selected project.
- Apply the owner-requested one-time migration: existing active accounts and unused invitations receive all current/future projects; revoked accounts stay revoked and roles are preserved.
- Full access can invite people and use project settings; only administrators revoke access or assign administrator rights. Self-demotion remains blocked.
- Add administrator controls to the user table. Project-card invitations use the common form and default to all projects for members with global full access.
- Preserve later explicit project-only invitations across restarts.
- Validation: 146 tests, typecheck and build, including legacy migration, restart, directory and privilege boundaries.

## 0.9.25 — 2026-11-13

- Show active, pending registration, expired and revoked access with invitation expiry.
- Invite to all current/future projects by default, or restrict access to one selected project. Only the service owner manages all-project grants; existing access stays scoped.
- Use stable project URLs without #; retain legacy links, invitation URLs, source fragments and browser history.
- Keep invitation status visible on mobile and stack invitation actions on narrow screens.
- Include previously prepared 0.9.24 changes in this repository: broader source selection, thematic answers and completion sound recovery.
- Validation: 144 tests, typecheck and build; 108 browser checks on synthetic data. Production verification is recorded in the release note after deployment.

## 0.9.24

- Broad product questions use report-aware, project-balanced evidence sampling, bounded to 48 unchanged originals and 36,000 characters. Repeated formats share the evidence budget; focused questions preserve their linked originals and access checks.
- Overview answers use thematic headings and citation lists in chat and print. Explicit foreign-product context is guarded conservatively; semantic retrieval is not claimed.
- Includes the supplied transcription notification MP3, retryable audio loading and a build-time check that prevents a missing sound asset.

Validation: typecheck, 141 tests and production build in three layouts; browser checks in both themes at 390/1024/1440px; real DeepSeek controls and public asset verification. No research, databases, secrets or private diagnostic output is included.

Published to Selectel only. GitHub and Amvera publication is not part of this release command. Dependencies and the existing 0.9.23 runtime are unchanged.

## 0.9.23

- Project report status appears beside the category badge.
- XLS uploads are supported alongside XLSX. Both formats open as tables in the material and source-file windows, with sheet names, original row numbers and column letters. Preview limits are explicit: files up to 20 MB, the first 1,000 populated rows and 100 columns per sheet. Stored values are displayed; formulas, macros and external links are never executed. Excel formatting is not reproduced.
- Includes invitation email delivery and existing-account project notifications from 0.9.22. Missing SMTP configuration retains manual invitation links. Transcription notifications and access checks are preserved.

Validation: typecheck, server tests, production build and browser checks on synthetic data. No production research is included in this release.

Runtime: xlrd 2.0.2 added to server/requirements-asr.txt. Use the full Docker build; the previous runtime alone cannot read XLS. Configure SMTP credentials only in the hosting environment. This release does not create users or send test messages automatically.

# 0.9.21 — прокрутка страницы над таблицами

- Колесо мыши и тачпад над таблицей снова прокручивают страницу. Раньше таблица «Исследования» в обзоре проекта перехватывала вертикальную прокрутку. Горизонтальная прокрутка широкой таблицы работает как раньше.

Новых runtime-зависимостей и изменений схемы БД нет.


# 0.9.20 — стрелка к проектам и компактные действия ответа

- На страницах проекта («Обзор», «Исследования», «Находки») слева от заголовка появилась стрелка «К проектам». На сенсорных экранах область нажатия 44 px.
- Действия под ответом чата — одной компактной строкой: кнопки 28 px, иконки 14 px, отступ от ответа 6 px.

Новых runtime-зависимостей и изменений схемы БД нет.


# 0.9.19 — поле чата в проекте, уведомление о загрузке и подключения моделей

- В проекте поле чата занимает всю ширину во всех видах, включая переписку после первого вопроса. Страница «Новый чат» остаётся 768 px по центру. Кнопка «Новый чат» убрана из шапки чата проекта.
- На телефоне пустое поле чата остаётся в одну строку: длинная подсказка обрезается многоточием.
- Уведомление «Загрузка завершена» скрывается само через 5 с и плавно уезжает вправо. Наведение или фокус удерживают его; если файл не загрузился, уведомление остаётся до действия человека.
- Встроенное подключение модели без ID модели или ключа можно удалить. Работающее встроенное подключение по-прежнему только выключается.
- Если провайдер не отдаёт список моделей, интерфейс подсказывает указать ID модели вручную.

Новых runtime-зависимостей и изменений схемы БД нет.


# 0.9.18 — скачивание файлов и поле чата на всю ширину проекта

- В таблице «Исследования» у каждого материала с исходным файлом появилась кнопка «Скачать»: файл сохраняется с исходным именем, а не открывается в браузере. Доступ проверяется так же, как при просмотре файла; без входа скачать нельзя.
- На страницах проекта поле чата занимает всю ширину основной области. На странице «Новый чат» оно остаётся 768 px по центру.

Новых runtime-зависимостей и изменений схемы БД нет.


# 0.9.17 — быстрое открытие проектов, компактный чат и панель источника

- Проекты открываются быстрее. Сервер сжимает ответы и файлы интерфейса (brotli или gzip): состояние проекта с расшифровками больше не передаётся мегабайтами при открытии и каждом обновлении. Список проектов в меню и на странице «Проекты» больше не разбирает полные расшифровки всех проектов на каждом запросе; карточки папок пересчитываются только после изменения проекта. При открытии проекта выполняется один запрос вместо двух.
- Поле чата компактное и одно на всём сайте: текст и кнопка отправки в одной строке, 54 px в пустом виде. Поле растёт по мере ввода до восьми строк, затем прокручивается. Название проекта под полем убрано; название материала показывается, только если вопрос задан по одному материалу.
- Новые сообщения появляются плавно: вопрос всплывает, ответ проявляется сверху вниз; длинный ответ — дольше, до 3,2 с. Сохранённая переписка открывается сразу. При уменьшенном движении анимации нет.
- Панель источника по сноске чата. На экране от 1200 px она встаёт справа отдельной карточкой и сдвигает содержимое; на узком экране выезжает поверх с края. Открытие 220 мс, закрытие 160 мс.
- Доступность для VoiceOver: страница под окном материала недоступна, пока окно открыто; новые сообщения чата объявляются; у страницы находок проекта правильный заголовок вкладки; в «Моделях» исправлен порядок заголовков.

Новых runtime-зависимостей и изменений схемы БД нет. Модель распознавания речи не менялась: Whisper Small int8. Large-v3-turbo проверена и отложена — на текущем сервере она в 3,4 раза медленнее и почти исчерпывает память.


# 0.9.16 — категории находок и таблица без горизонтального скролла

- Поиск и выбор проекта в общих находках заменены штатным переключателем Gravity UI «Все», «Проблемы», «Рекомендации», «Инсайты», как в таблице исследований. Категории фильтруют доступные находки, права просмотра сохраняются.
- «Важность» — первый столбец. «Критично» выделено красным бейджем, «Высокая» — оранжевым, «Средняя» — синим, «Низкая» — серым. Шкала и сохранённые данные не меняются.
- Статус «Проверено» отображается нейтральным серым бейджем. Черновики ИИ сохраняют отдельный статус.
- Таблица укладывается в ширину страницы, длинные названия переносятся. На узком экране проект и статус показаны под названием находки, чтобы сохранить всю информацию без горизонтальной прокрутки.
- Лампочки из строк таблицы убраны; иконки раздела и сносок сохранены.
- Подсказка в поле чата использует более спокойный цвет. Tab в пустом поле подставляет пример вопроса, Enter отправляет его. Заполненное поле, Shift+Tab и ввод через IME сохраняют обычное поведение клавиатуры.

Все изменения 0.9.14 и 0.9.15 включены: личные чаты, общие проекты и находки, Stars при ожидании, отправка готового вопроса одним кликом и появление нового ответа. Новых runtime-зависимостей нет.


# 0.9.15 — ожидание ответа и состояния чатов

По последнему уточнению убрана строка «Ответ по выборке: … материалов. Проверьте выводы по источникам» под ответами общего и проектного чатов.

Сноски на исходники и возможность проверить доказательства сохранены. Сервер продолжает учитывать охват материалов, отбор фрагментов и права доступа; меняется только отображение служебной строки.

Наведённая и выбранная строка беседы подсвечивается на всю ширину, включая область корзины. Действие удаления и клавиатурный фокус сохранены.

Во время запроса над полем отображается Stars по [референсу BoardUI](https://www.boardui.com/components/agent-thinking): пять мерцающих звёзд, подпись «Готовлю ответ…» и фактическое время ожидания. Индикатор исчезает при ответе или ошибке. При уменьшении движения звёзды статичны. Компонент собран на CSS и Lucide без новых зависимостей.

Убрана подпись «Мнемоника» над ответами. Клик по примеру вопроса сразу отправляет его в чат. Новый полученный ответ появляется с коротким проявлением снизу по характеру [референса Web Search](https://www.boardui.com/components/web-search); сохранённая история открывается сразу. При уменьшении движения эффект появления отключён.

Все изменения 0.9.14 включены: главная с общим чатом, личная серверная история, раздел «Проекты», общие находки, корзина при наведении, название 20 px и меню 14 px. Новых runtime-зависимостей нет.


# 0.9.14 — общий чат, история бесед и проекты

- Главная открывается новым общим чатом. Вопросы используют доступные исследования разных проектов; уточнения учитывают предыдущие сообщения беседы.
- Личные чаты сохраняются на сервере и доступны после перезагрузки. Название берётся из первого вопроса. Беседы можно продолжать или удалять из меню; корзина появляется при наведении и фокусе с клавиатуры, на сенсорных устройствах доступна постоянно. Удаление требует подтверждения.
- В разделе «Проекты» сразу показаны папки. Общего переключателя «Материалы / Проекты» нет: исследования находятся внутри проекта. Раздел «Находки» объединяет доступные выводы, сохраняя права просмотра и проверки.
- Стартовый чат оформлен по выбранному референсу Copilot: вопрос по центру, компактное поле, примеры снизу. В поле и под ответами нет названия модели и подписи общего охвата. Настройка модели остаётся в настройках.
- Источник по сноске открывается поверх переписки. Черновик вопроса сохраняется, после закрытия фокус возвращается к сноске.
- Пункты навигации используют шрифт 14 px, название «Мнемоника» — 20 px. «Новый чат» не получает постоянную подсветку; она остаётся у «Проектов», «Находок» и выбранной беседы.
- При открытии и продолжении чата сервер проверяет владельца, текущие права и доступность сохранённых цитат. Снижение роли, удаление, изменение или скрытие источника блокируют повторное использование ответа. Повышение до полного доступа запоминается на всю историю беседы.

При запуске создаётся таблица личных бесед SQLite. Материалы и находки не удаляются при удалении чата. Новых runtime-зависимостей нет. Локальные примеры и заглушка LLM в поставку не входят. Качество настоящей модели с новой историей требует отдельной проверки; синтетические тесты его не подтверждают.


# 0.9.13 — проекты, вход и оформление чата

- Компактные папки 232 × 186 px: имена, число файлов, документы при наведении, меню на верхнем правом выступе. Владелец переименовывает проект, добавляет участников с выбранной ролью и удаляет проект с проверкой обработки.
- На входе — фон Matrix с паузой, цвета Gravity UI и прежняя серверная авторизация. Логотип и название без номера версии; ссылка приглашения открывает инструкцию.
- В рабочих чатах текст 14 px: вопрос справа на нейтральной подложке, ответ слева без карточки, отступы между абзацами и пунктами. Сноски с лампочкой и номером открывают доступный исходный фрагмент. Ответы по-прежнему проверяются исследователем.
- Радиус 12 px ограничен общим чатом и папками на главной. Кнопки, поля, вкладки, меню и остальные элементы используют Gravity UI без глобального переопределения радиусов. Перед папками 32 px.

Runtime-зависимости не менялись. Реальные исследования, БД, ключи и локальные стенды в поставку не входят. Публикация в Amvera разрешена владельцем; основная ветка GitHub не обновляется этим выпуском.

# 0.9.12 — подготовка, не опубликована

- Компактные папки проектов с числом файлов и предпросмотром документов при наведении. Переименование, приглашение участников и удаление доступны из меню проекта с серверной проверкой прав и активной обработки.
- Перед папками 32 px отступа. Радиус 12 px применяется только к общему чату и папкам на главной; геометрия папок компенсирует масштаб SVG. Кнопки, поля, вкладки, меню и остальные элементы используют штатные радиусы Gravity UI.
- Логотип и название без номера версии на странице входа; фон Matrix с паузой и статичным вариантом при уменьшенной анимации. «Как получить ссылку» — синий Link из Gravity UI, открывающий инструкцию приглашения.
- Названия проектов переносятся и обрезаются с подсказкой. Убрана техническая подпись «Без темы» у материалов; в сносках чата используется лампочка с номером.
- В импорте выбор новой папки сбрасывает прежний результат переноса. Проверка очереди ожидает измеренный прогресс синтетического обработчика.

Экспериментальный обзор проекта и демочат из __design в эту ветку не входят. Runtime-зависимости не менялись. Сборка релизных пакетов и публикация ожидают отдельной команды владельца.

# 0.9.11 — связанные цитаты, отмена обработки и локальное хранение

- Сгруппированные ссылки модели преобразуются в отдельные кликабельные номера только при наличии каждого номера в исходном списке источников. Факты ответа и пакет данных не меняются.
- В контекст чата передаются названия уже проверенных находок со ссылками только на выбранные исходные фрагменты. Они служат контекстом интерпретации, не заменяют первичные данные. Отрицательный ответ при наличии таких связей проходит одну дополнительную проверку моделью; исходный вопрос и источники сохраняются, обоснованный отрицательный ответ допустим. Все вызовы учитываются в квотах, права повторно проверяются перед каждым вызовом и после генерации.
- Инструкция различает участника исследования и упомянутого контрагента: прямое описание собственного опыта не превращается в аналогию из-за другого действующего лица. Статус raw обозначает исходную реплику, а не отсутствие прямых данных; перенос между аудиториями требует явного запроса.
- Внутри материала чат сначала сохраняет весь пакет исходных цитат наиболее релевантной находки, затем переходит к следующим находкам. Между материалами сохраняется чередование. Это предотвращает вытеснение поздней цитаты основными ссылками множества более слабых находок. Поиск остаётся лексическим, бюджет ограничен, охват передаётся с ответом. Реальный повтор контрольного вопроса DeepSeek ещё требует проверки.
- Участник с полным доступом может удалить материал во время локального распознавания, OCR или определения спикеров. Сервер останавливает только задание этого материала, дожидается завершения дочернего процесса и очистки временных файлов, повторно проверяет доступ и удаляет материал с его локальным исходником и checkpoints. Обработка других материалов не отменяется. Пока выполняется сводка или поиск находок, удаление возвращает 409.
- `MNEMA_S3_ENABLED=0` явно отключает чтение и запись S3, фоновое копирование исходников и резервные копии SQLite в S3. Приложение использует постоянный диск Amvera: SQLite и исходники в `/data`. Уже созданные объекты S3 и параметры подключения не удаляются; выключенные копии не обновляются.

Изменения предназначены для code-only поставки. Пользовательские материалы, базы, ключи и checkpoints в репозиторий не включаются. «Что нового в интерфейсе» сохранено.

# 0.9.10 — очередь обработки, доказательства и отзыв MCP

- Анализ готовых материалов выполняется независимо от локального ASR/OCR. На CPU остаётся одна последовательная очередь; ожидающие документы получают приоритет перед следующими записями. Уже запущенное распознавание не прерывается.
- В интерфейсе различаются ожидание и работа. ASR сообщает пройденный таймкод и часть, определение спикеров — отдельный этап; журнал содержит старт, периодический статус, завершение и ошибку без текста исследования.
- Завершённые 15-минутные части ASR сохраняются в приватном `/data/processing/<job.id>`. После перезапуска то же задание продолжает с незавершённой части; новое явное задание не использует старый checkpoint. Полная расшифровка сохраняется до необязательного определения спикеров и не теряется при сбое этого этапа.
- При отборе источников для чата резервируется место под связанные исходные доказательства находок, включая поздние дополнительные цитаты. Отбор соблюдает область и права; при ограничении выборки передаётся её охват. Реальный повтор контрольного вопроса через DeepSeek после этой правки ещё предстоит; качество ответа не объявляется исправленным по одним тестам.
- OAuth MCP привязан к поколению согласия: отзыв и повторное подключение не оживляют старые access/refresh tokens. После обновления прежним OAuth-подключениям нужно снова подтвердить доступ. Исправлены учёт истёкших bot tokens в лимите и схема `bearer` без учёта регистра.
- Регрессии покрыты синтетическими HTTP/SDK-тестами и реальными локальными subprocess с подменёнными моделями. Внешние ChatGPT/Claude-клиенты, качество ASR на корпусе и production-восстановление частей ещё не проверены.

Новых runtime-зависимостей и изменений схемы БД нет. Исследования, базы, исходные записи, секреты и локальные стенды в поставку не входят. «Что нового в интерфейсе» не менялось.

# 0.9.8 — единый чат и обновление интерфейса

- Сервер и интерфейс берут номер версии из package.json; healthz соответствует версии сборки.
- Один компонент поля вопроса на главной и в проекте: одинаковые размеры, отступы, скругление 8 px и бегущий ободок. Охват исследований и выбор модели проекта сохранены; при уменьшенной анимации рамка статична. Вложения не добавлены.
- Фирменный цвет #EE204D у основных кнопок, белые подписи и иконки. Логотип светлый в тёмной теме и фирменный в светлой, выровнен по центру названия с версией; промежуток перед версией уменьшен.
- Тёмные поверхности обновлены, выбранный проект выделяется серым. В свёрнутом меню — подсветка и текстовые подсказки иконок.
- Компактные действия находок идут после статуса и прижаты вправо. «Снять выбор» находится рядом со счётчиком; пояснение под таблицей убрано.
- Из шапки материала удалена кнопка «Спросить».
- В настройках появился раздел «Интеграции»: Mattermost и Confluence со статусом «Разрабатывается». Реальные подключения пока не реализованы.

Поставка содержит код приложения, SVG-ресурсы, лицензии и описание релиза. Новых runtime-зависимостей и изменений схемы БД нет. Локальные стенды, исследования, базы, секреты и рабочие референсы в релиз не входят.

# 0.9.7 — хайлайты целыми словами

- Выделение для хайлайта расширяется до границ слов с обеих сторон: края цитаты не обрезают слова. Соседние строки документа не склеиваются; мягкие переносы Word не мешают сверке цитаты с материалом.

# 0.9.6 — окно материала: превью страниц, хайлайты, сворачиваемая панель

- PDF и Word (.docx) открываются страницами прямо в окне материала: PDF с выделяемым текстом, Word с исходной вёрсткой и шрифтами, выбор страницы, «Открыть в отдельном окне» и «Скачать» в меню. Сноски сводки прокручивают документ к цитате. Извлечённый текст остаётся ниже для сносок и исправлений.
- Хайлайты: выделите текст в документе или расшифровке и нажмите «Хайлайт». Сервер сохраняет только текст из материала; хайлайт подсвечивается на месте, карточка в панели ведёт к нему, из неё можно сделать находку. Создают и удаляют участники с полным доступом, видят все.
- Справа рейка разделов: «Суммаризация», «Хайлайты», «Находки», у видео «Спикеры». Повторный клик по открытому разделу или стрелка внизу сворачивает панель; материал встаёт по центру. Состояние запоминается.
- Повторы находок: группы с общей находкой объединяются в одну, чтобы старые дубли не оставались раздельно.
- Статика: файлы .mjs отдаются как JavaScript.

# 0.9.5 — смысловые повторы находок

- После поиска находок модель отдельным вызовом группирует находки материала, которые описывают одно и то же другими словами, включая уже существующие черновики. Остаётся самая важная, цитаты остальных становятся её доказательствами, лишние черновики ИИ удаляются.
- Решение человека важнее: повторы принятых, отклонённых и написанных вручную находок не добавляются, а сами они не меняются.
- При ошибке модели или больше 80 находок — прежняя склейка по совпадению слов; поиск находок не прерывается.
- Во вкладке «Находки» окна материала показан итог: новые черновики и объединённые повторы.

# 0.9.4 — находки: сбор по всему материалу и страница находки

- Поиск находок читает весь материал по частям (до 240 000 символов), а не только начало. Задача идёт в фоне, в общей очереди со сводками, и показывает ход: «Ищем находки · часть 2 из 3».
- Модель сама выбирает тип и важность по явным критериям и пишет короткое обоснование важности. Если человек меняет важность, обоснование ИИ убирается.
- Каждая находка ссылается на 1–3 существующих фрагмента; до 8 дополнительных доказательств из того же материала. Похожие находки из разных частей объединяются; уже существующие и отклонённые не предлагаются снова.
- Автосводка с находками: после сводки — отдельный проход поиска находок. При его сбое черновики берутся из блоков сводки, как раньше.
- Обзор проекта: пять главных находок, переход в таблицу и к находкам на проверке, добавление находки с выбором материала и цитаты.
- Страница находки: доказательства с переходом к фрагменту, повторяемость по проекту (по совпадению формулировок), материал и история. В таблице — колонки «Важность», «Повторы», «Проверка».
- Главная: «Что выяснить в исследованиях?».

# 0.9.3 — завершение расшифровки и рабочая область

- Favicon отмечает новую непросмотренную расшифровку: нижний правый элемент знака заменяется точкой. Открытие материала снимает отметку; первоначально готовые записи не вызывают уведомление. Звук выключается независимо от индикатора.
- Рабочая область: отступы 8 px сверху, справа и снизу, скругление 8 px; собственная прокрутка и закреплённая шапка. Вертикальная граница меню убрана.
- Нейтральная подложка из палитры Gravity UI в светлой теме — #F2F2F2. Текст и клавиатурный фокус меню усилены; измеренный контраст текста не ниже 8,09:1 в светлой и 7,57:1 в тёмной теме.
- Продуктовая версия, favicon и кэш логотипа — 0.9.3. Содержимое «Что нового в интерфейсе» и отметка прочтения не менялись.

# 0.9.2 — сводки, исходники и хранение

- Исправлены неполные сводки DeepSeek: thinking выключен явно, ответ проверяется как JSON с существующими источниками, допускается один ограниченный повтор. Временные сетевые ошибки и ответы 429/502/503/504 повторяются один раз.
- Активный анализ возобновляется после перезапуска; готовые сводки и прежние ошибки не пересоздаются автоматически.
- Исходник открывается отдельным окном без изменения колонок и прокрутки материала. PDF показан в основной области, извлечённый текст доступен отдельно.
- Панель материала: «Суммаризация / Находки», у видео также «Спикеры». Подписи проверены на 320–1440 px.
- В таблице и материале видны очередь/ход анализа, готовность и ошибка; убраны лишние счётчики исследований и заголовок над вопросом. Enter отправляет, Shift+Enter переносит строку; учтены IME и удержание клавиши.
- Исправлен дробный timeout длинных записей; видео занимает ширину своей колонки.
- Опциональное закрытое S3-хранилище: потоковое копирование исходников с проверкой суммы, авторизованная выдача и Range, резервная копия SQLite раз в час и проверка восстановления во временную базу. Локальные оригиналы пока сохраняются.

# 0.9.1 — Мнемоника и полировка интерфейса

- Главная: общий чат по всем доступным проектам, источники с названиями проектов, проверка прав до и после генерации, равномерная выборка по проектам.
- Обзор проекта: находки с важностью расположены перед исследованиями; новые автоматические сводки создают проверяемые черновики находок.
- Версия 0.9.1 расположена под названием, 12 px и отступ 4 px; исправлены контраст статусов/сносок/фокуса и перенос длинных заголовков.
- Все материалы, фильтры типов и переключатель вида перенесены в обзор проекта; «Добавить материал» находится у заголовка «Исследования». Убраны ссылка «Все материалы», ограничение в 6 карточек и лишняя подсказка под вопросом.
- Версия из package.json показана над логотипом (12 px) и в заголовке «Что нового в версии …».
- Настройки получили собственное левое меню «Модели / Пользователи» без проектной шапки и верхних вкладок; убрано лишнее пояснение о правах.
- Звук завершения расшифровки с выключателем в профиле; почтовые уведомления со сводкой и источниками подготовлены для SMTP (настройка отправителя обязательна).
- Убрана вкладка «Обработка»: блок «Обработчики» перенесён в «Модели», статусы — «Подключён» / «Не подключён». Старые ссылки на вкладку открывают «Модели».
- Логотип, название и β перенесены к форме по центру; добавлено описание сервиса, восстановлена инструкция «Как получить ссылку».

- Название интерфейса — «Мнемоника»; значок β добавлен к логотипу на входе и регистрации.
- Текущие версии, favicon и кэш логотипа приведены к 0.9.1.

- В окне материала панель «Сводка / Находки / Спикеры» шире (340 px на экранах шире 1100 px), подписи вкладок больше не обрезаются; на средних ширинах вкладки без иконок.

# 0.9.0 — спикеры и материал в окне

- Спикеры в расшифровке: локальное разделение по голосу на CPU (pyannote segmentation 3.0 + WeSpeaker ResNet34 через sherpa-onnx), подписи «Спикер 1…N». Новые записи размечаются после распознавания; для готовых — «Определить спикеров» без повторного распознавания. Переименование и перенос реплик, история правок на сервере, только с полным доступом. Сводка видит имена спикеров и не сбрасывается при переименовании.
- Материал открывается окном поверх «Исследований», «Обзора» или «Находок»; прямая ссылка работает, Esc и клик мимо окна закрывают его.
- Справа панель «Сводка / Находки / Спикеры». Черновики находок принимаются и отклоняются прямо в панели, есть «Принять все».
- Сноски в сводке — номера в конце абзаца; клик подсвечивает реплику и переводит запись.
- Видео показывает первый кадр и кнопку «Смотреть запись».
- Карточка исследования в виде строки: миниатюра с длительностью, тип, название, дата, находки, спикеры.
- Убраны «Все проекты» в меню, подпись под названием, три точки у профиля, стрелка на карточке проекта, табы статусов на «Находках» и кнопка переноса исследований; вместо подписи — значок беты.
- Выравнивание иконок в сегментах и кнопках, крошки на одной линии, ширина контента 1104 px, отступы по шкале 24/32/48, сдержанные микроанимации с учётом prefers-reduced-motion.

# 0.8.0 — проекты и импорт исследований

- Проекты в меню: материалы и находки внутри проекта, вопросы и ответы в обзоре. Общий поиск и отдельная вкладка чата убраны.
- DOC, DOCX и XLSX; автосводка по переключателю при загрузке; общие вопросы показывают объём выборки фрагментов.
- Контекст проекта закреплён в запросах и ссылках исходников, соседние вкладки его не подменяют.
- Импорт папки выгрузки из внешней системы исследований: исходники с проверкой SHA-256, готовые расшифровки с таймкодами и паспорта. Повтор не создаёт дублей. Готовые выводы источника не переносятся: после загрузки сервер ставит материалы в очередь выбранной модели, новые сводки и находки остаются черновиками ИИ. Импорт выключен, пока не задан `MNEMA_IMPORT_SOURCE_ORIGIN`.
- Выравнивание иконок, пустые состояния, проверка компоновки на 320/375/768/1440 px.

# 0.7.0 — Мнемонио: сводка и работа с расшифровкой

- Summary errors explain recovery without technical jargon; the error state replaces the initial empty-state prompt.
- Structured JSON output for DeepSeek, tolerant extraction of complete JSON objects, and metadata-only provider diagnostics; truncated responses are rejected.
- Русское название «Мнемонио», знак Shapes Gallery (Shape 69) с указанием автора.
- Два поля входа и регистрации: «Рабочая почта» и «Пароль», внутренние подписи Gravity UI. Имя берётся из приглашения; доступ по приглашениям сохранён.
- Сводка на странице материала: очередь, сохранение, ссылки на исходные фрагменты, повтор после ошибки и подтверждение человеком. Читатель видит только проверенную сводку.
- Длинные материалы обрабатываются по частям; ID источников проверяются сервером. После исправления текста прежняя сводка сбрасывается.
- Возобновление загрузки частями по 512 КБ, отдельный индикатор передачи, идемпотентное завершение и автоматическая очередь ASR при установленном обработчике.
- Группировка расшифровки, компактный плеер, ручные исправления с сохранением оригинала и истории, раскрываемый паспорт исследования.
- Улучшен контраст полей и адаптивность основных экранов. Варианты плотности формы доступны по специальному параметру __variant.

Распознавание остаётся на Whisper Small int8 без диаризации. Улучшение точности или скорости ASR этим релизом не заявляется. Требуется отдельная проверка бэкапа и восстановления данных.

# 0.6.0 — пространства и TypeScript

- Пространства: создание, переключение под логотипом, свои исследования, находки, модели и участники. Существующие данные переносятся в пространство «Команда».
- Удаление исследований (вместе с находками и исходным файлом) и пользовательских подключений моделей; встроенные можно только выключить.
- Меню: кнопка сворачивания, раздел «Настройки» с вкладками «Модели», «Обработка», «Пользователи».
- Меню профиля: тема (как в системе, светлая, тёмная), «Пригласить людей», «Что нового в интерфейсе».
- Контентная область 1104 px, общее выравнивание по левому краю.
- Код переведён на TypeScript; Node.js 24 запускает сервер из `.ts`. В CI добавлена проверка типов.

# 0.5.0 — проверка находок

- Статусы находок «Черновик ИИ», «Проверено», «Отклонено», история проверки на сервере; участник с просмотром получает только проверенное.
- Предложение находок моделью, массовое принятие и отклонение.
- Паспорт исследования, состояние «отчёта нет» и пометка «по сырым данным».
- Шаблон ответа чата, сноски с источником в боковой панели, копирование и сохранение ответа в PDF.

# 0.4.0 — локальное распознавание и DeepSeek

- Whisper Small int8: речь и таймкоды на CPU, без внешнего ASR и диаризации.
- Poppler + Tesseract rus+eng: обычные и сканированные PDF, номера страниц.
- Очередь по одному файлу; аудио разбивается на 15-минутные части, PDF обрабатывается постранично.
- DeepSeek V4 через Amvera; проверка подключения владельцем, лимит запросов и токенов на сервере.
- «Библиотека» переименована в «Исследования». Большие файлы загружаются частями по 512 КБ с прогрессом.
- 9 серверных проверок, включая смешанный PDF и ограничение страниц.

# История изменений

## 0.3.1 — 2026-11-10

- Таблицы Gravity UI занимают всю ширину блока, включая пустое состояние.
- Имя и уровень доступа в профиле показаны отдельными строками.
- Временный каталог интеграционных тестов совместим с Linux и macOS.

## 0.3.0 — 2026-11-10

Первый серверный релиз Мнемы.

### Добавлено

- Better Auth и постоянная SQLite-база.
- Первичная настройка владельца по секрету, вход по паролю и одноразовые приглашения.
- Серверные роли, запрет самостоятельного повышения прав и немедленный отзыв доступа.
- Защищённая загрузка файлов; извлечение текста TXT/PDF и фрагменты источника.
- Адаптер совместимого LLM API и очередь распознавания Soniox; для работы нужны ключи владельца.
- Новая регистрация на Gravity UI, темы, Lucide и адаптивная навигация.
- Docker-поставка, endpoint /healthz, CI и документация на русском.

### Исправлено

- У текстовых документов больше нет демонстрационного плеера и вымышленной длительности.
- В серверной версии не используются фиксированный код входа и подготовленные демо-ответы.

### Ограничения

Ключи поставщиков, доставка писем, embeddings, OCR и проверка восстановления не входят в первый выпуск. Производительность распознавания на реальных записях ещё не измерена.
