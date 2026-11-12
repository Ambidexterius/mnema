# Сторонние компоненты

Мнема использует React и Better Auth, Gravity UI, Lucide и Inter. Их лицензии и уведомления сохраняются в соответствующих npm-пакетах, app/licenses и app/vendor/fonts/OFL.txt. Зависимости закреплены в package-lock.json.

Этот файл не назначает лицензию собственному коду Мнемы. Она будет выбрана владельцем проекта отдельно.

Whisper Small и faster-whisper: MIT, https://huggingface.co/Systran/faster-whisper-small и https://github.com/SYSTRAN/faster-whisper. CTranslate2: MIT. Tesseract и языковые модели: Apache-2.0, https://tesseract-ocr.github.io/tessdoc/. Poppler и FFmpeg поставляются из Debian; соответствующие лицензии и copyright находятся в /usr/share/doc контейнера. Требования ASR закреплены в server/requirements-asr.txt; модель закреплена по revision в Dockerfile.

Разделение спикеров: sherpa-onnx и sherpa-onnx-core 2.0.1 — Apache-2.0, https://github.com/k2-fsa/sherpa-onnx. pyannote segmentation 3.0 — MIT, © 2022 CNRS, https://huggingface.co/pyannote/segmentation-3.0, ONNX-экспорт k2-fsa. WeSpeaker ResNet34 (VoxCeleb) — модель следует лицензии датасета VoxCeleb, Creative Commons Attribution 4.0, https://github.com/wenet-e2e/wespeaker и https://mm.kaist.ac.kr/datasets/voxceleb/. Модели скачиваются при сборке образа с проверкой SHA-256 (server/fetch-diarization-models.py).

## Shapes Gallery

Original Shape 69: Monika Michalczyk, https://www.shapes.gallery/. Geometry retained; color and viewBox adapted. See app/licenses/shapes-gallery.md.

## Предпросмотр документов

В собранный интерфейс входят pdf.js (pdfjs-dist 6.4.299, Apache-2.0, https://github.com/mozilla/pdf.js) — страницы PDF и текстовый слой; docx-preview 0.4.1 (Apache-2.0, https://github.com/VolodymyrBaydalka/docxjs) — страницы Word; JSZip (MIT или GPL-3.0-or-later, используется по MIT, https://github.com/Stuk/jszip). Тексты лицензий — в соответствующих npm-пакетах; версии закреплены в package-lock.json.

## Декоративная рамка чата

Conic-gradient border adapted from Liquid Multimodal Input by Wensity Labs (MIT), https://21st.dev/@wensity/components/liquid-multimodal-input. See app/licenses/21st-liquid-input.md.

## Matrix

Matrix rain renderer: Copyright (c) 2026 mishanaer, MIT, https://github.com/mishanaer/matrix. Revision 291b7bfa4682b8518837dfb3eb846a6f1a4f4433. Renderer copied unchanged; theme, mask and pause controls supplied by the application. Full license: app/vendor/matrix/LICENSE.
