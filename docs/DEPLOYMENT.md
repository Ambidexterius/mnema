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

Настройка LLM выполняется владельцем: URL API, идентификатор модели и имя серверного ключа. Поддерживается формат Chat Completions; прямой Anthropic Messages API в эту версию не входит. Произвольные адреса внутренней сети не разрешаются.

Квоты запросов не равны лимиту расходов в рублях. Перед подключением платных API задайте ограничения у поставщика и проверьте стоимость на небольшом корпусе. Распознавание записей и PDF выполняется локально. Вопросы передают отобранные фрагменты подключённой LLM. Подробнее — [обработчики](PROCESSING.md). Загрузка идёт частями по 512 КБ, до 2 ГБ/файл; повтор части идемпотентен, неполные загрузки хранятся до 24 часов.

## Проверка после запуска

Проверьте HTTPS, /healthz, настройку владельца, приглашение читателя, запрет изменения и доступа после отзыва, загрузку документа и переход к исходнику. Перезапустите контейнер и убедитесь, что данные сохранились. Затем настройте резервные копии /data и проверьте восстановление на отдельном тестовом экземпляре.

## Release 0.7.0 acceptance

After deploying, check the two-field login, SVG logo and /healthz version, then request a summary from an existing recording with the real configured provider. Verify waiting/running/ready states, citations and persistence after a browser reload. Keep the generated summary as a draft until a human checks it. Summary creation sends the full allowed transcript in chunks to the selected LLM and counts toward request/token limits. A chat request sends only selected fragments.

For initial owner provisioning, use POST /api/register with email, password and setupToken, X-Mnema-Request: 1 and the configured Origin. A public sign-up form is not an alternative to the one-time setup secret. Never put the setup secret in public documentation or a shared URL.

## Optional runtime reuse on Amvera

`deploy/Dockerfile.amvera-runtime` builds the current application on a previously verified runtime image that already contains Node, Whisper and OCR. Supply your own immutable image reference through the required build argument `MNEMONIO_RUNTIME_IMAGE`. The recipe checks that production dependency declarations are unchanged and replaces the application code and public files. If dependencies, the model or system packages change, use the root full-build Dockerfile instead. No private registry credentials are included in this repository.

The root Dockerfile remains the portable full build. The runtime-reuse recipe is a deployment option; it does not change the application version or replace the current server code with the old version.
