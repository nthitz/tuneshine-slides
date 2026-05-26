#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v git >/dev/null 2>&1; then
  echo "git is not installed or not in PATH" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

if [ ! -f compose.yaml ] && [ ! -f docker-compose.yml ]; then
  echo "No compose.yaml or docker-compose.yml found in $(pwd)" >&2
  exit 1
fi

mkdir -p .cache slides gallery

echo "Pulling latest code..."
git pull --ff-only

echo "Rebuilding and recreating Docker service..."
if docker compose version >/dev/null 2>&1; then
  docker compose up -d --build --force-recreate
else
  echo "docker compose is not available for this user." >&2
  echo "Try: sudo docker compose up -d --build --force-recreate" >&2
  exit 1
fi

echo "Update complete."
sh scripts/print-web-url.sh
