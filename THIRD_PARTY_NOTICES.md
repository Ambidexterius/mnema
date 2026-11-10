# Сторонние компоненты

Мнема использует React и Better Auth, Gravity UI, Lucide и Inter. Их лицензии и уведомления сохраняются в соответствующих npm-пакетах, app/licenses и app/vendor/fonts/OFL.txt. Зависимости закреплены в package-lock.json.

Этот файл не назначает лицензию собственному коду Мнемы. Она будет выбрана владельцем проекта отдельно.

Whisper Small и faster-whisper: MIT, https://huggingface.co/Systran/faster-whisper-small и https://github.com/SYSTRAN/faster-whisper. CTranslate2: MIT. Tesseract и языковые модели: Apache-2.0, https://tesseract-ocr.github.io/tessdoc/. Poppler и FFmpeg поставляются из Debian; соответствующие лицензии и copyright находятся в /usr/share/doc контейнера. Требования ASR закреплены в server/requirements-asr.txt; модель закреплена по revision в Dockerfile.

## Shapes Gallery

Original Shape 69: Monika Michalczyk, https://www.shapes.gallery/. Geometry retained; color and viewBox adapted. See app/licenses/shapes-gallery.md.
