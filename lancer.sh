#!/usr/bin/env bash
# Lance le mini chat + un tunnel Cloudflare, et affiche le lien à envoyer.
# Usage : ./lancer.sh            (demande le code d'accès)
#         CODE=monsecret ./lancer.sh
set -euo pipefail
cd "$(dirname "$0")"

for cmd in node "${CLAUDE_BIN:-claude}" cloudflared; do
  command -v "$cmd" >/dev/null || { echo "Manque : $cmd (voir README.md)"; exit 1; }
done

if [ -z "${CODE:-}" ]; then
  read -rsp "Choisis un code d'accès (6+ caractères) : " CODE; echo
fi
export CODE PORT="${PORT:-3000}"

node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
sleep 1

echo "Tunnel en cours de démarrage… le lien https://….trycloudflare.com apparaît ci-dessous."
if command -v caffeinate >/dev/null; then
  caffeinate -i cloudflared tunnel --url "http://localhost:$PORT"   # macOS : empêche la veille
else
  cloudflared tunnel --url "http://localhost:$PORT"
fi
