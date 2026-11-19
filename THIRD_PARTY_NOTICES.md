# Сторонние компоненты

Мнема использует React и Better Auth, Gravity UI, Lucide и Inter. Их лицензии и уведомления сохраняются в соответствующих npm-пакетах, app/licenses и app/vendor/fonts/OFL.txt. Зависимости закреплены в package-lock.json.

Этот файл не назначает лицензию собственному коду Мнемы. Она будет выбрана владельцем проекта отдельно.

GigaAM v3: MIT, © 2024 GigaChat Team, https://github.com/salute-developers/GigaAM, ONNX-экспорт k2-fsa (https://huggingface.co/csukuangfj/sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16). Silero VAD: MIT, https://github.com/snakers4/silero-vad. Модели скачиваются при сборке образа с проверкой SHA-256 (server/fetch-asr-model.py). Whisper Small и faster-whisper: MIT, https://huggingface.co/Systran/faster-whisper-small и https://github.com/SYSTRAN/faster-whisper. CTranslate2: MIT. Tesseract и языковые модели: Apache-2.0, https://tesseract-ocr.github.io/tessdoc/. Poppler и FFmpeg поставляются из Debian; соответствующие лицензии и copyright находятся в /usr/share/doc контейнера. Требования ASR закреплены в server/requirements-asr.txt; модель закреплена по revision в Dockerfile.

Разделение спикеров: sherpa-onnx и sherpa-onnx-core 2.0.1 — Apache-2.0, https://github.com/k2-fsa/sherpa-onnx. pyannote segmentation 3.0 — MIT, © 2022 CNRS, https://huggingface.co/pyannote/segmentation-3.0, ONNX-экспорт k2-fsa. WeSpeaker ResNet34 (VoxCeleb) — модель следует лицензии датасета VoxCeleb, Creative Commons Attribution 4.0, https://github.com/wenet-e2e/wespeaker и https://mm.kaist.ac.kr/datasets/voxceleb/. Модели скачиваются при сборке образа с проверкой SHA-256 (server/fetch-diarization-models.py).

## Shapes Gallery

Прежний знак Shape 69: Monika Michalczyk, https://www.shapes.gallery/. С 17.11.2026 заменён на MnemoDuck. Историческое уведомление сохранено в app/licenses/shapes-gallery.md.

## Предпросмотр документов

В собранный интерфейс входят pdf.js (pdfjs-dist 6.4.299, Apache-2.0, https://github.com/mozilla/pdf.js) — страницы PDF и текстовый слой; docx-preview 0.4.1 (Apache-2.0, https://github.com/VolodymyrBaydalka/docxjs) — страницы Word; JSZip (MIT или GPL-3.0-or-later, используется по MIT, https://github.com/Stuk/jszip). Тексты лицензий — в соответствующих npm-пакетах; версии закреплены в package-lock.json.

## Декоративная рамка чата

Conic-gradient border adapted from Liquid Multimodal Input by Wensity Labs (MIT), https://21st.dev/@wensity/components/liquid-multimodal-input. See app/licenses/21st-liquid-input.md.

## Matrix

Matrix rain renderer: Copyright (c) 2026 mishanaer, MIT, https://github.com/mishanaer/matrix. Revision 291b7bfa4682b8518837dfb3eb846a6f1a4f4433. Renderer adaptation from the shipped MatrixRain implementation; theme, mask and pause controls supplied by the application. Full license: app/vendor/matrix/LICENSE.

## Project folders

Visual reference: Glassmorphism Folder Cards by Kedhareswer Naidu, https://21st.dev/@kedhareswer/components/glass-folder-cards. Folder geometry and interaction are implemented for this application with a shared radius and project access controls.

## MnemoDuck

Логотип и анимации предоставлены владельцем проекта в архиве MnemoDuck_assets.zip 17.11.2026. SVG используются в исходном виде; иконка уведомления дополнена красной отметкой. Описание происхождения — app/licenses/mnemoduck.md.

## MnemoDuck Living

Живая аватарка чата: SVG из архива MnemoDuck_Living_Solid_D_v2.zip, предоставленного владельцем проекта 17.11.2026. Графика и тайминги адаптированы для общего Mascot; описание — app/licenses/mnemoduck.md.

## Новости продукта

В описаниях новостей Markdown отображает markdown-to-jsx 9.10.6 (MIT, Evan Jacobs). Лицензия лежит в app/licenses/markdown-to-jsx.txt.
