#!/usr/bin/env sh
set -eu

web_port="${WEB_PORT:-}"
if [ -z "$web_port" ] && [ -f .env ]; then
  web_port="$(sed -n 's/^[[:space:]]*WEB_PORT[[:space:]]*=[[:space:]]*//p' .env | tail -n 1)"
  web_port="${web_port%%#*}"
  web_port="$(printf '%s' "$web_port" | tr -d '[:space:]\"' | tr -d "'")"
fi

web_port="${web_port:-3000}"

echo
echo "Web UI:"
echo "  http://localhost:$web_port"
echo "  http://<docker-host>:$web_port"
