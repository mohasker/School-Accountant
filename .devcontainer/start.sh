#!/usr/bin/env bash
# Starts the demo (synthetic data, PGlite database under .data/demo) in the background.
set -euo pipefail
mkdir -p .data
if [ -z "${DEMO_PASSWORD:-}" ]; then
  export DEMO_PASSWORD='Madar-Trial-2026'
  echo "DEMO_PASSWORD not set as a Codespaces secret; using the default trial password: $DEMO_PASSWORD"
fi
pkill -f "scripts/demo.ts" 2>/dev/null || true
nohup npm run demo > .data/demo.log 2>&1 &
echo "مدار يعمل الآن: افتح تبويب PORTS ثم المنفذ 3000. السجل: .data/demo.log"
