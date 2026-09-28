#!/usr/bin/env bash
# Madar V0 — installs or updates the system on a fresh Ubuntu/Debian cloud server, in one command:
#
#   curl -fsSL https://raw.githubusercontent.com/mohasker/School-Accountant/main/deploy/install.sh | sudo bash
#
# First run: installs Docker, asks for the domain and the system administrator, starts everything
# behind HTTPS, creates the administrator and schedules a daily database backup.
# Later runs: back up, fetch the latest version and restart (data is kept).
# Without a domain the server gets a free address <ip>.sslip.io with HTTPS.
set -euo pipefail

DIR=${MADAR_DIR:-/opt/madar}
BRANCH=${MADAR_BRANCH:-main}
REPO=${MADAR_REPO:-https://github.com/mohasker/School-Accountant.git}
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml)

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mخطأ: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local v; read -r -p "$1" v < /dev/tty; printf '%s' "$v"; }

[ "$(id -u)" -eq 0 ] || die "شغّل الأمر بـ sudo"
command -v apt-get > /dev/null || die "هذا السكربت لخوادم Ubuntu أو Debian"

# Small servers: Chromium (PDF) and ClamAV (upload scanning) need memory headroom.
if [ "$(swapon --noheadings | wc -l)" -eq 0 ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 7000000 ]; then
  say "إضافة ذاكرة احتياطية (swap 2GB)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker > /dev/null || ! command -v git > /dev/null; then
  say "تثبيت Docker وGit"
  apt-get update -qq && apt-get install -y -qq git curl ca-certificates openssl > /dev/null
  command -v docker > /dev/null || curl -fsSL https://get.docker.com | sh
fi

if [ -d "$DIR/.git" ]; then
  cd "$DIR"
  if [ -n "$("${COMPOSE[@]}" ps -q db 2> /dev/null)" ]; then
    say "نسخة احتياطية قبل التحديث"
    mkdir -p /var/backups/madar
    "${COMPOSE[@]}" exec -T db pg_dump -U school -Fc school_accounting > "/var/backups/madar/before-update-$(date +%F-%H%M).backup"
  fi
  say "جلب آخر نسخة ($BRANCH)"
  git fetch -q origin "$BRANCH" && git checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  say "تنزيل النظام إلى $DIR"
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
  cd "$DIR"
fi

if [ ! -f .env ]; then
  say "الإعداد الأول"
  IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN=$(ask "الدومين (مثل madar-school.com) — اتركه فارغاً لاستخدام عنوان مجاني: ")
  [ -n "$DOMAIN" ] || DOMAIN="${IP//./-}.sslip.io"
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
  ADMIN_USERNAME=$(ask "اسم دخول مدير النظام بالإنجليزية (مثل asker): ")
  [[ "$ADMIN_USERNAME" =~ ^[a-zA-Z0-9_.-]{3,50}$ ]] || die "اسم الدخول: حروف إنجليزية وأرقام فقط (3 على الأقل)"
  ADMIN_NAME=$(ask "الاسم الظاهر لمدير النظام: ")
  while true; do
    read -r -s -p "كلمة مرور مدير النظام (12 حرفاً على الأقل): " ADMIN_PASSWORD < /dev/tty; echo
    read -r -s -p "أعد كتابتها: " again < /dev/tty; echo
    if [ ${#ADMIN_PASSWORD} -lt 12 ]; then echo "قصيرة، أعد المحاولة."
    elif [ "$ADMIN_PASSWORD" != "$again" ]; then echo "غير متطابقتين، أعد المحاولة."
    elif [[ "$ADMIN_PASSWORD" =~ [\"\$\`\\\'] ]]; then echo "لا تستخدم الرموز \" ' \$ \` \\"
    else break; fi
  done
  umask 077
  cat > .env << EOF
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_NAME="${ADMIN_NAME//\"/}"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
TENANT_NAME="مَدار"
EOF
fi

if command -v ufw > /dev/null && ufw status | grep -q active; then ufw allow 22/tcp > /dev/null; ufw allow 80/tcp > /dev/null; ufw allow 443/tcp > /dev/null; fi
# Oracle Cloud Ubuntu images ship iptables rules that reject everything except SSH.
if [ -f /etc/iptables/rules.v4 ] && command -v iptables > /dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport $port -j ACCEPT 2> /dev/null || iptables -I INPUT 1 -p tcp --dport $port -j ACCEPT
  done
  iptables-save > /etc/iptables/rules.v4
fi

say "بناء وتشغيل النظام (أول مرة 5–10 دقائق)"
"${COMPOSE[@]}" up --build -d

if [ ! -f .bootstrapped ]; then
  say "إنشاء مدير النظام ودليل بنود الموازنة"
  "${COMPOSE[@]}" run --rm api npm run bootstrap
  touch .bootstrapped
  sed -i '/^ADMIN_PASSWORD=/d' .env
fi

cat > /etc/cron.d/madar-backup << EOF
# Daily database backup (includes uploaded documents), kept 30 days.
0 2 * * * root cd $DIR && ${COMPOSE[*]} exec -T db pg_dump -U school -Fc school_accounting > /var/backups/madar/madar-\$(date +\%F).backup && find /var/backups/madar -name 'madar-*.backup' -mtime +30 -delete
EOF
mkdir -p /var/backups/madar

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
say "✅ مَدار يعمل: https://$DOMAIN"
echo "   ادخل باسم مدير النظام وكلمة المرور التي اخترتها."
echo "   إن لم يفتح فوراً انتظر دقيقة لإصدار شهادة HTTPS. لو استخدمت دومينك تأكد أن سجل A يشير إلى هذا الخادم."
echo "   للتحديث لاحقاً: أعد تشغيل نفس أمر التثبيت."
