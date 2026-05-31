#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
    sudo docker compose "$@"
    return
  fi

  echo "docker compose is not available for this user, with or without sudo." >&2
  exit 1
}

if [ ! -f compose.yaml ] && [ ! -f docker-compose.yml ]; then
  echo "No compose.yaml or docker-compose.yml found in $(pwd)" >&2
  exit 1
fi

docker_compose down --timeout 10
