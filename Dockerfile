FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY app ./app
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-fund --no-audit

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils antiword ffmpeg gosu ca-certificates python3 python3-venv tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/requirements-asr.txt /tmp/requirements-asr.txt
RUN python3 -m venv /opt/asr && /opt/asr/bin/pip install --no-cache-dir -r /tmp/requirements-asr.txt
RUN HF_HUB_DISABLE_XET=1 /opt/asr/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small', revision='536b0662742c02347bc0e980a01041f333bce120', local_dir='/app/models/whisper-small', allow_patterns=['model.bin','config.json','tokenizer.json','vocabulary.*','preprocessor_config.json'])" && rm -rf /root/.cache /app/models/whisper-small/.cache
COPY server/fetch-diarization-models.py /tmp/fetch-diarization-models.py
RUN /opt/asr/bin/python /tmp/fetch-diarization-models.py /app/models/diarization && rm /tmp/fetch-diarization-models.py
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./public
COPY server ./server
COPY app/material-activity.ts ./app/material-activity.ts
COPY app/finding-repeats.ts ./app/finding-repeats.ts
COPY app/highlight-text.ts ./app/highlight-text.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh && mkdir -p /data/uploads && chown node:node /data /data/uploads
ENV NODE_ENV=production PORT=3000 MNEMA_DATA_DIR=/data MNEMA_PUBLIC_DIR=/app/public ASR_MODEL_DIR=/app/models/whisper-small ASR_DIARIZATION_DIR=/app/models/diarization ASR_CPU_THREADS=1 OCR_LANGUAGES=rus+eng HF_HUB_OFFLINE=1
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
