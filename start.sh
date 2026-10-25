#!/usr/bin/env sh
# Start FlexPOS (after ./install.sh)
set -e
cd "$(dirname "$0")"
DIR=$(pwd)
if [ ! -f apps/server/dist/main.js ]; then
  echo "[X] Not installed yet. Run ./install.sh first" >&2
  exit 1
fi
export PORT="${PORT:-4100}"
export FLEXPOS_DATA_DIR="${FLEXPOS_DATA_DIR:-$DIR/data}"
export FLEXPOS_WEB_DIR="$DIR/apps/web/dist"
export FLEXPOS_FONTS_DIR="$DIR/apps/server/dist/fonts"
export NODE_ENV=production
echo "FlexPOS running at http://localhost:$PORT"
exec node apps/server/dist/main.js
