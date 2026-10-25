#!/usr/bin/env bash
# FlexPOS Cloud installer for Debian 13 (trixie) "standard". Run as root from a FlexPOS checkout:
#
#   sudo DOMAIN=strata-pos.itdev.in.th CF_TUNNEL_TOKEN=<token> SUPERADMIN_EMAIL=you@example.com \
#        bash deploy/cloud/install-debian.sh
#
# Re-run the same command to upgrade: it rebuilds, keeps the database, env file and secrets.
# Everything lives apart from the shops' POS machines:
#   /opt/flexpos-cloud           program        /etc/flexpos-cloud.env   settings + secrets
#   PostgreSQL db flexpos_cloud  all store data /var/log/flexpos-cloud   logs
#   /var/backups/flexpos-cloud   daily pg_dump (14 days)
set -euo pipefail

DOMAIN="${DOMAIN:-strata-pos.itdev.in.th}"
PORT="${PORT:-4200}"
APP_DIR=/opt/flexpos-cloud
DATA_DIR=/var/lib/flexpos-cloud
LOG_DIR=/var/log/flexpos-cloud
BACKUP_DIR=/var/backups/flexpos-cloud
ENV_FILE=/etc/flexpos-cloud.env
SVC_USER=flexpos-cloud
DB_NAME=flexpos_cloud
DB_USER=flexpos_cloud
SRC="$(cd "$(dirname "$0")/../.." && pwd)"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -f "$SRC/apps/cloud/package.json" ] || { echo "Run from inside the FlexPOS source folder." >&2; exit 1; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg postgresql postgresql-contrib logrotate cron rsync

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ] || ! command -v corepack >/dev/null; then
  say "Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v

say "Service user and folders"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR" "$LOG_DIR"
install -d -o postgres -g postgres -m 750 "$BACKUP_DIR"
install -d -m 755 "$APP_DIR"

say "PostgreSQL database"
systemctl enable --now postgresql
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  JWT="$(openssl rand -base64 48 2>/dev/null | tr -d '\n' || head -c 48 /dev/urandom | base64 -w0)"
  su postgres -c "psql -qtAc \"select 1 from pg_roles where rolname='$DB_USER'\"" | grep -q 1 \
    && su postgres -c "psql -qc \"alter role $DB_USER with login password '$DB_PASS'\"" \
    || su postgres -c "psql -qc \"create role $DB_USER with login password '$DB_PASS'\""
  su postgres -c "psql -qtAc \"select 1 from pg_database where datname='$DB_NAME'\"" | grep -q 1 \
    || su postgres -c "createdb -O $DB_USER $DB_NAME"
  umask 077
  cat > "$ENV_FILE" <<ENV
# FlexPOS Cloud settings. Restart after editing: systemctl restart flexpos-cloud
NODE_ENV=production
TZ=Asia/Bangkok
HOST=127.0.0.1
PORT=$PORT
PUBLIC_URL=https://$DOMAIN
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
JWT_SECRET=$JWT
LOG_FILE=$LOG_DIR/app.log
FLEXPOS_CLOUD_DATA=$DATA_DIR
# 1 = a POS may create a new store + manager account when it first connects
ALLOW_SIGNUP=1
ENV
  chown root:"$SVC_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  echo "keeping existing $ENV_FILE"
fi

say "Build"
cd "$SRC"
export ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=1
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @flexpos/cloud-web build
corepack pnpm --filter @flexpos/cloud build

say "Install to $APP_DIR"
rsync -a --delete --exclude node_modules "$SRC/apps/cloud/dist/" "$APP_DIR/"
cd "$APP_DIR"
[ -f package.json ] || echo '{"name":"flexpos-cloud-runtime","private":true,"type":"module"}' > package.json
npm install --omit=dev --no-audit --no-fund pg@8 @node-rs/argon2@2 @electric-sql/pglite@0.3
chown -R root:root "$APP_DIR"

say "systemd service"
cat > /etc/systemd/system/flexpos-cloud.service <<UNIT
[Unit]
Description=FlexPOS Cloud (web dashboard + POS sync)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$DATA_DIR
ExecStart=/usr/bin/node $APP_DIR/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR $LOG_DIR
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable flexpos-cloud
systemctl restart flexpos-cloud

say "Log rotation and daily backup"
cat > /etc/logrotate.d/flexpos-cloud <<ROT
$LOG_DIR/*.log {
  daily
  rotate 30
  compress
  missingok
  notifempty
  copytruncate
}
ROT
cat > /etc/cron.d/flexpos-cloud-backup <<CRON
# Daily database dump at 03:15, keep 14 days
15 3 * * * postgres pg_dump -Fc $DB_NAME > $BACKUP_DIR/flexpos_cloud-\$(date +\%F).dump && find $BACKUP_DIR -name '*.dump' -mtime +14 -delete
CRON

if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  say "Cloudflare Tunnel"
  if ! command -v cloudflared >/dev/null; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -q && apt-get install -y -q cloudflared
  fi
  cloudflared service install "$CF_TUNNEL_TOKEN" || systemctl restart cloudflared
fi

say "Health check"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then echo "FlexPOS Cloud is running on 127.0.0.1:$PORT"; break; fi
  sleep 1
  [ "$i" = 20 ] && { echo "Service did not start. See: journalctl -u flexpos-cloud -n 100" >&2; exit 1; }
done

if [ -n "${SUPERADMIN_EMAIL:-}" ]; then
  say "Superadmin $SUPERADMIN_EMAIL"
  if [ -z "${SUPERADMIN_PASSWORD:-}" ]; then read -r -s -p "Password for $SUPERADMIN_EMAIL (8+ chars): " SUPERADMIN_PASSWORD; echo; fi
  set -a; . "$ENV_FILE"; set +a
  runuser -u "$SVC_USER" -- /usr/bin/node "$APP_DIR/main.js" create-superadmin --email "$SUPERADMIN_EMAIL" --password "$SUPERADMIN_PASSWORD"
fi

cat <<DONE

Done.
  Web dashboard : https://$DOMAIN  (through Cloudflare)
  Service       : systemctl status flexpos-cloud     logs: journalctl -u flexpos-cloud -f  /  $LOG_DIR/app.log
  Settings      : $ENV_FILE
  Backups       : $BACKUP_DIR
  Superadmin    : re-run with SUPERADMIN_EMAIL=you@example.com to add one or reset its password
DONE
