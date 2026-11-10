#!/bin/sh
set -eu
mkdir -p "${MNEMA_DATA_DIR:-/data}/uploads"
if [ "$(id -u)" = 0 ]; then
  chown node:node "${MNEMA_DATA_DIR:-/data}" "${MNEMA_DATA_DIR:-/data}/uploads"
  exec gosu node node /app/server/server.ts
fi
exec node /app/server/server.ts
