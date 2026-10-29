#!/usr/bin/env bash
# MOESAS — the practical-trial server, in one command on a fresh Ubuntu/Debian cloud server:
#
#   curl -fsSL https://raw.githubusercontent.com/mohasker/School-Accountant/claude/vibrant-bell-tj6ext/deploy/install-trial.sh | sudo bash
#
# Synthetic trial data only, with the shared account «زائر» / 112233. Asks only for the domain (or uses
# the free address <ip>.sslip.io). Running it again updates the system and keeps the trial data.
set -euo pipefail

DIR=${MADAR_DIR:-/opt/moesas-trial}
BRANCH=${MADAR_BRANCH:-claude/vibrant-bell-tj6ext}
REPO=${MADAR_REPO:-https://github.com/mohasker/School-Accountant.git}
# A private repository: pass a read-only GitHub token as MADAR_TOKEN (it is not stored on the server).
[ -z "${MADAR_TOKEN:-}" ] || REPO="https://x-access-token:${MADAR_TOKEN}@${REPO#https://}"
COMPOSE=(docker compose -f deploy/docker-compose.trial.yml --env-file .env)

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mخطأ: %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local v; read -r -p "$1" v < /dev/tty || true; printf '%s' "$v"; }

[ "$(id -u)" -eq 0 ] || die "شغّل الأمر بـ sudo"
command -v apt-get > /dev/null || die "هذا السكربت لخوادم Ubuntu أو Debian"

# Small servers: building the system and Chromium (PDF) need memory headroom.
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
  say "جلب آخر نسخة ($BRANCH) — بيانات التجربة تبقى كما هي"
  git fetch -q "$REPO" "$BRANCH" && git checkout -q -B "$BRANCH" FETCH_HEAD
else
  say "تنزيل النظام إلى $DIR"
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
  cd "$DIR"
  git remote set-url origin "${MADAR_REPO:-https://github.com/mohasker/School-Accountant.git}"
fi

if [ ! -f .env ]; then
  say "الإعداد الأول"
  IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN=${DOMAIN:-$(ask "الدومين (مثل trial.moesas-qatar.com) — اتركه فارغاً لاستخدام عنوان مجاني: ")}
  [ -n "$DOMAIN" ] || DOMAIN="${IP//./-}.sslip.io"
  DOMAIN=${DOMAIN#https://}; DOMAIN=${DOMAIN#http://}; DOMAIN=${DOMAIN%%/*}
  umask 077
  cat > .env << ENV
DOMAIN=$DOMAIN
DEMO_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)
TRIAL_GUEST_PASSWORD=112233
SECRETS_KEY=$(openssl rand -hex 32)
ENV
fi

if command -v ufw > /dev/null && ufw status | grep -q active; then ufw allow 22/tcp > /dev/null; ufw allow 80/tcp > /dev/null; ufw allow 443/tcp > /dev/null; fi
# Oracle Cloud Ubuntu images ship iptables rules that reject everything except SSH.
if [ -f /etc/iptables/rules.v4 ] && command -v iptables > /dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport $port -j ACCEPT 2> /dev/null || iptables -I INPUT 1 -p tcp --dport $port -j ACCEPT
  done
  iptables-save > /etc/iptables/rules.v4
fi

say "بناء وتشغيل نسخة التجربة (أول مرة 5–15 دقيقة)"
"${COMPOSE[@]}" up --build -d

say "انتظار تجهيز بيانات التجربة"
for _ in $(seq 1 120); do
  "${COMPOSE[@]}" logs trial 2> /dev/null | grep -q 'Ready in' && break
  sleep 5
done

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
ADMIN=$(grep '^DEMO_PASSWORD=' .env | cut -d= -f2)
say "✅ نسخة التجربة تعمل: https://$DOMAIN"
echo "   الحساب المشترك للتعميم:  زائر  /  112233"
echo "   حسابات الإدارة (لك وحدك، لا تُعمَّم): admin / accountant / supervisor — كلمة المرور: $ADMIN"
echo "   إن لم يفتح فوراً انتظر دقيقة لإصدار شهادة HTTPS. لو استخدمت دومينك تأكد أن سجل A يشير إلى هذا الخادم."
echo "   للتحديث لاحقاً: أعد تشغيل نفس الأمر (البيانات تبقى)."
echo "   لإعادة التجربة من البداية: cd $DIR && ${COMPOSE[*]} down -v && sudo bash deploy/install-trial.sh"
