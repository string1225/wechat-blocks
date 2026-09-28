#!/usr/bin/env bash
# Run as root from an extracted release. Never overwrites credentials or the DB.
set -euo pipefail
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
case "$release_dir" in /opt/wechat-blocks/releases/*) ;; *) echo 'Extract under /opt/wechat-blocks/releases first' >&2; exit 1;; esac
id wechat-blocks >/dev/null 2>&1 || useradd --system --home-dir /var/lib/wechat-blocks --shell /sbin/nologin wechat-blocks
install -d -m 0750 -o root -g wechat-blocks /etc/wechat-blocks
install -d -m 0700 -o wechat-blocks -g wechat-blocks /var/lib/wechat-blocks
if [ ! -f /etc/wechat-blocks/server.env ]; then
    install -m 0640 -o root -g wechat-blocks /dev/null /etc/wechat-blocks/server.env
    cat > /etc/wechat-blocks/server.env <<'ENV'
WECHAT_APP_ID=wxdd87cda01434e266
WECHAT_APP_SECRET=
PORT=3040
PROGRESS_DB=/var/lib/wechat-blocks/progress.sqlite3
ALLOWED_ORIGINS=https://www.sunny-string.cn,https://home.sunny-string.cn,http://127.0.0.1:3000,http://localhost:3000
ENV
fi
chown root:wechat-blocks /etc/wechat-blocks/server.env
chmod 0640 /etc/wechat-blocks/server.env
install -m 0644 "$release_dir/server/wechat-blocks.service" /etc/systemd/system/wechat-blocks.service
install -m 0644 "$release_dir/server/wechat-blocks-backup.service" /etc/systemd/system/wechat-blocks-backup.service
install -m 0644 "$release_dir/server/wechat-blocks-backup.timer" /etc/systemd/system/wechat-blocks-backup.timer
install -d -m 0755 /etc/nginx/snippets
install -m 0644 "$release_dir/server/nginx-location.conf" /etc/nginx/snippets/wechat-blocks-location.conf
python3 - <<'PY'
from pathlib import Path
import shutil
config = Path('/etc/nginx/conf.d/sunny-string.conf')
text = config.read_text()
line = '    include /etc/nginx/snippets/wechat-blocks-location.conf;'
anchor = '    include /etc/nginx/snippets/remote-meeting-location.conf;'
if line not in text:
    if text.count(anchor) != 1:
        raise SystemExit('Expected exactly one HTTPS server anchor; Nginx config not changed')
    shutil.copy2(config, config.with_suffix('.conf.before-blocks'))
    config.write_text(text.replace(anchor, anchor + '\n' + line))
PY
nginx -t
ln -sfn "$release_dir" /opt/wechat-blocks/current
systemctl daemon-reload
systemctl enable --now wechat-blocks.service wechat-blocks-backup.timer
systemctl restart wechat-blocks.service
systemctl reload nginx
curl --fail --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:3040/health
systemctl start wechat-blocks-backup.service
