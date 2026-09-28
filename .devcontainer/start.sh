#!/usr/bin/env bash
# Starts the demo (synthetic data, PGlite database under .data/demo), waits until it answers,
# then prints the address to open. Safe to run again at any time.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p .data

# Finish the one-time setup if it did not complete.
[ -d node_modules ] || npm ci --no-audit --no-fund
[ -d apps/web/.next ] || npm run build

if [ -z "${DEMO_PASSWORD:-}" ]; then
  export DEMO_PASSWORD='Madar-Trial-2026'
  echo "كلمة مرور التجربة: $DEMO_PASSWORD"
fi

pkill -f "scripts/demo.ts" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
sleep 1
# Detached from this terminal so it keeps running after the command returns.
setsid nohup npm run demo > .data/demo.log 2>&1 < /dev/null &
disown || true

if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  URL="http://localhost:3000"
fi

echo "جارٍ تشغيل مَدار…"
for _ in $(seq 1 60); do
  if curl -s -o /dev/null -f http://localhost:3000/; then
    echo "✅ مَدار يعمل الآن: $URL"
    echo "الحسابات: admin / accountant / approver"
    exit 0
  fi
  sleep 2
done
echo "❌ لم يبدأ النظام خلال دقيقتين. آخر سطور السجل (.data/demo.log):"
tail -40 .data/demo.log
exit 1
