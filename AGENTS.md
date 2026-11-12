# Мнемоника

Читайте README.md, CHANGELOG.md, docs/ARCHITECTURE.md и docs/DEPLOYMENT.md. Используйте Gravity UI и Lucide, сохраняйте серверные права и изоляцию исходников. Не подменяйте настоящие ответы демонстрационными данными. Не записывайте ключи, базы и реальные записи в Git.

Перед отправкой изменений: npm run check (типы, тесты, сборка). Не выполняйте production-деплой автоматически после PR. Публикация — отдельное действие владельца. Секретов хостинга и рабочих исследований в этом репозитории нет.


## Interface conventions in 0.9.12

Use Gravity UI and Lucide. Home and project chat share ChatComposer; keep their data scopes separate. Rectangular surfaces use the shared --mn-radius token at 12 px. Keep the 8 px workspace inset and the 32 px gap before project folders. The logo is light in dark mode and #EE204D in light mode; primary action backgrounds are #EE204D with white text/icons. Selected navigation is neutral gray. Never publish research, data, secrets, local workbenches or private reference material.

Release 0.9.12 is local only. Do not push any branch, merge to main/master, create release archives, or deploy to Amvera until the owner explicitly requests publication.
