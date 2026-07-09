#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "tunnel" ]]; then
  shift
  docker compose --profile tunnel down "$@"
else
  docker compose down "$@"
fi
