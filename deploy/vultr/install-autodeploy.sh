#!/usr/bin/env bash
# Run as root from the existing server checkout. Does not print/read app secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(id -u)" != 0 ]]; then
  echo "Run this installer as root on your Vultr server." >&2
  exit 1
fi
# Safe reinstall: serialize script/config replacement with any existing deployment.
if systemctl cat restaurantos-deploy.service >/dev/null 2>&1; then
  systemctl stop restaurantos-deploy.timer restaurantos-deploy.service
fi
python3 - <<'PY'
import json
from pathlib import Path
import subprocess

def output(args):
    return subprocess.check_output(args, text=True)

app = json.loads(output(['docker', 'inspect', 'restaurantos-app-1']))[0]
if app['State'].get('Health', {}).get('Status') != 'healthy':
    raise SystemExit('The existing app must be healthy before installing automatic deployment.')
caddy = json.loads(output(['docker', 'inspect', 'restaurantos-caddy-1']))[0]
values = dict(line.split('=', 1) for line in caddy['Config']['Env'] if '=' in line)
if not values.get('APP_DOMAIN') or not values.get('ACME_EMAIL'):
    raise SystemExit('The existing Caddy container needs APP_DOMAIN and ACME_EMAIL.')
runtime = Path('/opt/restaurantos/runtime.env')
if not runtime.is_file():
    raise SystemExit('Missing /opt/restaurantos/runtime.env')
config = Path('/etc/restaurantos-deploy.json')
# No shell exports needed by future timer executions; never copy runtime secrets.
config.write_text(json.dumps({
    'checkout': str(Path.cwd()),
    'state': '/var/lib/restaurantos-deploy',
    'compose': '/opt/restaurantos/deployment/compose.yaml',
    'runtime_env': str(runtime),
    'domain': values['APP_DOMAIN'], 'email': values['ACME_EMAIL'],
}, indent=2) + '\n')
config.chmod(0o600)
PY
install -d -m 700 /usr/local/lib/restaurantos /var/lib/restaurantos-deploy /opt/restaurantos/deployment
install -m 600 deploy/vultr/autodeploy.py /usr/local/lib/restaurantos/autodeploy.py
install -m 600 deploy/vultr/compose.yaml deploy/vultr/Caddyfile /opt/restaurantos/deployment/
install -m 644 deploy/vultr/restaurantos-deploy.service deploy/vultr/restaurantos-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now restaurantos-deploy.timer
systemctl start --no-block restaurantos-deploy.service
echo "Automatic deployment enabled. Follow: journalctl -u restaurantos-deploy -f"
