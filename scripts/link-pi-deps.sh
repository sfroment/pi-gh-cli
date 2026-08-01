#!/usr/bin/env bash
# Link pi runtime packages into local node_modules so `bun test` can resolve
# `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox`
# (which the extension imports but does not bundle — they are provided by the
# pi agent runtime at load time).
set -euo pipefail
cd "$(dirname "$0")/.."

# Try: active node global, then the pi-coding-agent install location.
PI_DIR=""
for candidate in \
  "$(node -e "console.log(require('path').resolve(process.argv[1]))" -- "$(npm root -g 2>/dev/null)/@earendil-works/pi-coding-agent" 2>/dev/null)" \
  "/Users/sacha.froment/.vite-plus/js_runtime/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent" \
  "$(node -p --experimental-require-module 'require.resolve("@earendil-works/pi-coding-agent/package.json")' 2>/dev/null | xargs dirname 2>/dev/null)"; do
  if [ -n "$candidate" ] && [ -d "$candidate/dist" ]; then
    PI_DIR="$candidate"
    break
  fi
done

if [ -z "$PI_DIR" ]; then
  echo "Could not locate @earendil-works/pi-coding-agent. Is pi installed?" >&2
  exit 1
fi

mkdir -p node_modules/@earendil-works
ln -sfn "$PI_DIR" node_modules/@earendil-works/pi-coding-agent
ln -sfn "$PI_DIR/node_modules/@earendil-works/pi-ai" node_modules/@earendil-works/pi-ai
ln -sfn "$PI_DIR/node_modules/typebox" node_modules/typebox
echo "Linked pi runtime packages from $PI_DIR"
