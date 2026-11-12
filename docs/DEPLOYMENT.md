# Развёртывание

## Docker / Amvera

В корне находятся Dockerfile и amvera.yml. Образ Node 24.15.0 закреплён digest. Сборка устанавливает зависимости по lockfile, собирает frontend и оставляет runtime-зависимости. Приложение выполняется пользователем node; entrypoint подготавливает доступ к /data.

Настройте один экземпляр, порт контейнера 3000 и постоянный каталог /data. Нельзя хранить SQLite в каталоге сборки. Endpoint проверки — GET /healthz; HTTP 200 означает, что сервер запущен, но не подтверждает доступность внешних провайдеров.

## Обязательное окружение

| Переменная | Назначение |
|---|---|
| APP_URL | Полный HTTPS-адрес сервиса для cookies и проверки origin |
| BETTER_AUTH_SECRET | Случайный секрет авторизации, не менее 32 символов |
| MNEMA_SETUP_TOKEN | Секрет первичной настройки владельца |
| MNEMA_DATA_DIR | /data |
| MNEMA_PUBLIC_DIR | /app/public |
| NODE_ENV | production |
| PORT | 3000 |

Секреты задаются через средства платформы. Их нельзя записывать в Dockerfile, Git или публичные логи. После первого создания владельца setup-token не создаёт другие аккаунты; участников добавляют приглашениями.

## Дополнительные настройки

| Переменная | Назначение |
|---|---|
| MNEMA_STORAGE_LIMIT_BYTES | Квота загрузок; по умолчанию 4 ГиБ |
| MNEMA_S3_ENABLED | `0` явно выключает все операции S3; данные читаются и записываются на постоянный диск. При отсутствии флага S3 включается, если задан bucket |
| LLM_MONTHLY_REQUEST_LIMIT | Число вопросов в месяц; по умолчанию 1 200 |
| LLM_KEY_DEEPSEEK | Серверный ключ подключения DeepSeek |
| LLM_MODEL_DEEPSEEK | Идентификатор модели; можно задать и в интерфейсе |
| LLM_KEY_CUSTOM1 / LLM_KEY_CUSTOM2 | Ключи дополнительных подключений |
| LLM_ALLOWED_HOSTS | Разрешённые домены API, через запятую |
| ASR_MODEL_DIR | Каталог локальной модели, /app/models/whisper-small |
| ASR_DIARIZATION_DIR | Модели спикеров, /app/models/diarization (`segmentation.onnx`, `embedding.onnx`) |
| ASR_DIARIZATION / ASR_DIARIZATION_THRESHOLD | `0` выключает разделение спикеров / порог кластеризации, по умолчанию 0.7 |
| ASR_CPU_THREADS / OCR_LANGUAGES | 1 / rus+eng |
| MNEMA_LLM_PRESET | amvera-deepseek-v4 для купленного пакета Amvera |
| LLM_MONTHLY_TOKEN_LIMIT | 2 800 000 токенов за календарный UTC-месяц |
| MNEMA_IMPORT_SOURCE_ORIGIN | Адрес внешней системы исследований для импорта, например https://research.example.com. Пусто — импорт выключен |

Настройка LLM выполняется владельцем: URL API, идентификатор модели и имя серверного ключа. Поддерживаются совместимый Chat Completions API, OpenAI Responses и Anthropic Messages; ключ можно сохранить через интерфейс в зашифрованном виде или задать секретом окружения. Произвольные адреса внутренней сети не разрешаются.

Квоты запросов не равны лимиту расходов в рублях. Перед подключением платных API задайте ограничения у поставщика и проверьте стоимость на небольшом корпусе. Распознавание записей и PDF выполняется локально. Вопросы передают отобранные фрагменты подключённой LLM. Подробнее — [обработчики](PROCESSING.md). Загрузка идёт частями по 512 КБ, до 2 ГБ/файл; повтор части идемпотентен, неполные загрузки хранятся до 24 часов.

## Проверка после запуска

Проверьте HTTPS, /healthz, настройку владельца, приглашение читателя, запрет изменения и доступа после отзыва, загрузку документа и переход к исходнику. Перезапустите контейнер и убедитесь, что данные сохранились. Затем настройте резервные копии /data и проверьте восстановление на отдельном тестовом экземпляре.

## Release 0.9.1 acceptance

After deploying, check the two-field login, SVG logo and /healthz version, then request a summary from an existing recording with the real configured provider. Verify waiting/running/ready states, citations and persistence after a browser reload. Keep the generated summary as a draft until a human checks it. Summary creation sends the full allowed transcript in chunks to the selected LLM and counts toward request/token limits. A chat request sends only selected fragments.

For initial owner provisioning, use POST /api/register with email, password and setupToken, X-Mnema-Request: 1 and the configured Origin. A public sign-up form is not an alternative to the one-time setup secret. Never put the setup secret in public documentation or a shared URL.

## Optional runtime reuse on Amvera

`deploy/Dockerfile.amvera-runtime` builds the current application on a previously verified runtime image that already contains Node, Whisper and OCR. Supply your own immutable image reference through the required build argument `MNEMONIO_RUNTIME_IMAGE`. The recipe checks that production dependency declarations are unchanged and replaces the application code and public files. If dependencies, the model or system packages change, use the root full-build Dockerfile instead. No private registry credentials are included in this repository.

The root Dockerfile remains the portable full build. The runtime-reuse recipe is a deployment option; it does not change the application version or replace the current server code with the old version.


## Completion email

Optional SMTP completion notifications: [MAIL.md](MAIL.md). Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM and APP_URL in the hosting environment. Invitation links remain manual. No SMTP credentials are included.


## 0.9.3 storage and runtime checks

Закрытое S3 настраивается через MNEMA_S3_BUCKET, MNEMA_S3_PREFIX, MNEMA_S3_ENDPOINT, MNEMA_S3_REGION и секреты MNEMA_S3_ACCESS_KEY_ID / MNEMA_S3_SECRET_ACCESS_KEY. Для хранения только на постоянном диске Amvera задайте `MNEMA_S3_ENABLED=0` и примените конфигурацию к работающему приложению. Флаг отключает чтение, запись, зеркалирование исходников и резервное копирование SQLite в S3. Секреты подключения можно сохранить; прежние объекты S3 не удаляются и больше не обновляются. Данные приложения остаются в постоянном `/data`; настройте для него отдельное резервное копирование и проверьте восстановление. Удаление материала при выключенном S3 не удаляет его старую копию в bucket.

The runtime must include app/material-activity.ts, imported by server code. Check runtime imports as well as TypeScript/build. After release, verify /healthz version 0.9.3, deployed JS/CSS, access controls, the 8 px workspace frame and the completion favicon. Interface news content is intentionally unchanged.

## Проверки выпуска 0.9.11

Перед выпуском выполните `npm run check` и smoke-import серверного runtime. При обновлении версии без checkpoints незавершённое распознавание после перезапуска начнётся заново. В новой версии завершённые части сохраняются в постоянном `/data`. HTTP 200 `/healthz` не подтверждает готовность обработчиков или качество LLM.

После выкладки проверьте `/healthz` версии 0.9.11 и соответствие JS/CSS сборке; очередь и работа должны различаться. На синтетическом примере проверьте независимый анализ во время ASR, приоритет ожидающего документа, измеренный прогресс и возобновление завершённых частей. Реальные записи и checkpoints не копируйте в репозиторий. Постоянный `/data` нужен также для `/data/processing/<job.id>`; сохранение частей не заменяет бэкап. Для режима без S3 проверьте `MNEMA_S3_ENABLED=0`, авторизованную выдачу исходника с `X-Mnema-Storage: local`, отсутствие новых операций S3 и сохранность SQLite и исходников после перезапуска. На синтетическом материале проверьте удаление активной локальной задачи: процесс должен завершиться до удаления его файлов, checkpoints исчезнуть, а соседняя задача и другой проект остаться доступными. При сводке или поиске находок ожидается 409. Реальные исходники для этого теста не используйте.

Проверьте отзыв и повторное подключение MCP: прежний access/refresh token не должен получить доступ. Старым OAuth-подключениям потребуется повторная авторизация. Четыре инструмента MCP доступны только на чтение по выбранным проектам и серверным ролям. Официальный SDK проверен на синтетических данных; реальные внешние ChatGPT/Claude-клиенты ещё не проверены.

Повторите контрольный вопрос на настоящем DeepSeek, убедитесь в передаче полного пакета связанных цитат наиболее релевантной находки, проверьте ответ и переходы по ссылкам. Внутри материала пакет выбирается целиком перед следующими находками, между материалами сохраняется чередование; бюджет и область доступа остаются ограниченными. На момент подготовки этой документации такой повтор после правки ещё не выполнен. Не объявляйте качество исправленным по HTTP 200 или регрессионному тесту. Safari/VoiceOver, нагрузка, ASR на корпусе и полный restore drill остаются отдельными проверками.

В code-only поставку входят только код, зависимости по lockfile, ресурсы интерфейса и общая документация. Новых runtime-зависимостей в 0.9.11 нет; проверяйте совпадение деклараций при повторном использовании runtime. При смене dependencies/моделей/системных пакетов нужна полная сборка. Не включайте `/data`, исследования, приватные исходники, ключи, локальные стенды, рабочие логи и checkpoints. «Что нового в интерфейсе» в этом выпуске не менялось.
