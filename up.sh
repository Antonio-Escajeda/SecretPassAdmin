#!/usr/bin/env bash

set -euo pipefail

cert_dir="$(dirname "$0")/certs"
cert_file="$cert_dir/localhost+1.pem"
key_file="$cert_dir/localhost+1-key.pem"

if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
  if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert no está instalado. Instalando..." >&2
    if command -v brew >/dev/null 2>&1; then
      brew install mkcert
    elif command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y mkcert libnss3-tools
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y mkcert nss-tools
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -Sy --noconfirm mkcert nss
    else
      echo "No se pudo detectar un gestor de paquetes soportado (brew/apt/dnf/pacman). Instalá mkcert manualmente: https://github.com/FiloSottile/mkcert" >&2
      exit 1
    fi
  fi

  mkdir -p "$cert_dir"
  mkcert -install || echo "Aviso: no se pudo instalar/confirmar la CA local de mkcert (¿falta sudo interactivo?). Si el navegador no confía en el certificado, corré 'mkcert -install' manualmente." >&2
  mkcert -cert-file "$cert_file" -key-file "$key_file" localhost 127.0.0.1
fi

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
