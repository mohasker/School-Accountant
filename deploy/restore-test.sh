#!/usr/bin/env bash
# Restores the newest backup into a throw-away PostgreSQL container and prints row counts, so a backup
# is known to be usable before it is needed. Run monthly:  sudo bash deploy/restore-test.sh
set -euo pipefail
DIR=${BACKUP_DIR:-/var/backups/madar}
FILE=$(ls -t "$DIR"/madar-*.backup 2>/dev/null | head -1)
[ -n "$FILE" ] || { echo "لا توجد نسخة احتياطية في $DIR"; exit 1; }
echo "اختبار استعادة: $FILE"
NAME=madar-restore-test
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=school_accounting postgres:16 >/dev/null
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
docker cp "$FILE" "$NAME":/tmp/b.backup
docker exec "$NAME" pg_restore -U postgres -d school_accounting --no-owner --no-privileges /tmp/b.backup
echo "الصفوف بعد الاستعادة:"
docker exec "$NAME" psql -U postgres -d school_accounting -Atc "
SELECT 'المدارس: '||count(*) FROM \"School\"
UNION ALL SELECT 'المعاملات: '||count(*) FROM \"Case\"
UNION ALL SELECT 'الشهادات: '||count(*) FROM \"Certificate\"
UNION ALL SELECT 'القيود: '||count(*) FROM \"Ledger\"
UNION ALL SELECT 'مستندات الأرشيف: '||count(*) FROM \"Archive\";"
docker rm -f "$NAME" >/dev/null
echo "✓ النسخة قابلة للاستعادة. احتفظ أيضاً بـ SECRETS_KEY من ملف .env مع النسخة."
