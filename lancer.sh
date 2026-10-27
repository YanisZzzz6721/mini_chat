#!/usr/bin/env bash
# Lance le mini chat + un tunnel Cloudflare, et affiche le lien à envoyer.
# Si le tunnel meurt (réseau coupé, Mac en veille, tunnel supprimé par Cloudflare),
# il est relancé tout seul et le NOUVEAU lien s'affiche : renvoie-le à la personne.
# Usage : ./lancer.sh            (demande le code d'accès)
#         CODE=monsecret ./lancer.sh
set -uo pipefail
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

# macOS : empêche la veille tant que le script tourne (écran, disque, système sur secteur)
if command -v caffeinate >/dev/null; then caffeinate -dims -w $$ & fi

TUNNEL_CMD=(cloudflared tunnel --protocol http2 --no-autoupdate --url "http://localhost:$PORT")
echo "Serveur démarré. Ctrl+C pour tout arrêter."

while true; do
  echo "Création du tunnel…"
  erreurs=0
  # On filtre les journaux : lien, état de la connexion, et redémarrage si le tunnel est supprimé
  "${TUNNEL_CMD[@]}" 2>&1 | while IFS= read -r ligne; do
    case "$ligne" in
      *https://*.trycloudflare.com*)
        lien=$(printf '%s' "$ligne" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
        if [ -n "$lien" ]; then
          echo
          echo "  LIEN À ENVOYER : $lien"
          echo
        fi ;;
      *"Registered tunnel connection"*) erreurs=0; echo "  ● Connecté" ;;
      *"Tunnel not found"*)
        erreurs=$((erreurs + 1))
        if [ "$erreurs" -ge 3 ]; then
          echo "  ● Tunnel supprimé par Cloudflare, relance…"
          pkill -f "cloudflared tunnel .*--url http://localhost:$PORT" 2>/dev/null
          break
        fi ;;
      *"no recent network activity"*) echo "  ● Réseau coupé, reconnexion…" ;;
    esac
  done
  echo "Tunnel arrêté. Nouveau tunnel dans 3 s… (un nouveau lien va s'afficher)"
  sleep 3
done
