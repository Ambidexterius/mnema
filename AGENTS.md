# Мнемоника

Читайте README.md, CHANGELOG.md, docs/ARCHITECTURE.md и docs/DEPLOYMENT.md. Используйте Gravity UI и Lucide, сохраняйте серверные права и изоляцию исходников. Не подменяйте настоящие ответы демонстрационными данными. Не записывайте ключи, базы и реальные записи в Git.

Перед отправкой изменений: npm run check (типы, тесты, сборка). Не выполняйте production-деплой автоматически после PR. Публикация — отдельное действие владельца. Секретов хостинга и рабочих исследований в этом репозитории нет.


## Interface conventions in 0.9.13

Use Gravity UI and Lucide. Home and project chat share ChatComposer; keep their data scopes separate. Only the global composer and project folders on the home page use --mn-home-radius at 12 px. Other controls use Gravity UI's own radius values; do not override the global --g-* radius tokens. Keep the 8 px workspace inset and the 32 px gap before project folders. The logo is light in dark mode and #EE204D in light mode; primary action backgrounds are #EE204D with white text/icons. Selected navigation is neutral gray. Never publish research, data, secrets, local workbenches or private reference material.


Current release 0.9.13: the owner explicitly authorized code-only release packaging and push/deployment to Amvera. GitHub main/master remains on hold. Use Gravity UI defaults outside the home chat and project folders.


## Release 0.9.14

Owner-authorized publication of this release to GitHub main and Amvera. Navigation labels are 14 px, the sidebar wordmark is 20 px; the new-chat action has no persistent selected state. Global chat histories are personal, stored by the server, and revalidated against current source visibility and original role grants. Source citations open above the conversation. Keep prototype/__design, work, outputs, user data and secrets out of the release.


## Release 0.9.15

Owner follow-up during the authorized release: omit the sampled-material coverage sentence below global and project answers. Keep server-side coverage, source citations and access controls.
