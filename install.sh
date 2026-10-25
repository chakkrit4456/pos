#!/usr/bin/env sh
# FlexPOS installer for Linux / macOS
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[X] Node.js not found. Install Node.js 20+ from https://nodejs.org" >&2
  exit 1
fi
major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
  echo "[X] Node.js $major is too old, need 20+" >&2
  exit 1
fi

echo "[1/3] Installing packages ..."
ELECTRON_SKIP_BINARY_DOWNLOAD=1 corepack pnpm install --frozen-lockfile
echo "[2/3] Building web app ..."
corepack pnpm --filter @flexpos/web build
echo "[3/3] Building server ..."
corepack pnpm --filter @flexpos/server build
echo "[OK] Done. Run ./start.sh"
