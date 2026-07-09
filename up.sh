#!/usr/bin/env bash

set -euo pipefail

tunnel_mode="false"

if [[ "${1:-}" == "tunnel" ]]; then
  tunnel_mode="true"
  shift
  docker compose --profile tunnel up -d "$@"
else
  docker compose up -d "$@"
fi

quick_tunnel_url=""

for _ in {1..30}; do
  quick_tunnel_url="$({ docker compose logs cloudflared --tail 50 2>/dev/null || true; } | rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' -m 1 || true)"

  if [[ -n "$quick_tunnel_url" ]]; then
    break
  fi

  sleep 1
done

if [[ -n "$quick_tunnel_url" ]]; then
  printf '\nQuick Tunnel URL: %s\n' "$quick_tunnel_url"
elif [[ "$tunnel_mode" == "true" ]]; then
  printf '\nQuick Tunnel URL not found yet. Check with: docker compose logs cloudflared\n'
fi
