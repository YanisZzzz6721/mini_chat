#!/usr/bin/env bash
# Superviseur de Postuler : vérifie l'installation, lance le serveur et le tunnel Cloudflare,
# surveille leur santé, relance ce qui tombe et envoie des e-mails.
#
#   ./lancer.sh                 lance tout (Ctrl+C pour arrêter)
#
# Réglages dans .env.local (ignoré par Git, voir .env.local.example) : CODE, MAIL_TO_USER, MAIL_TO_ADMIN, SMTP_*.
# Journaux dans logs/ : superviseur.log, serveur.log, tunnel.log, mails-test.txt.
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs

[ -f .env.local ] && { set -a; . ./.env.local; set +a; }

PORT="${PORT:-3000}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
LOG=logs/superviseur.log
LIEN_FILE=logs/lien.txt
: > "$LIEN_FILE"
rm -f logs/.lien-annonce

# ---------------------------------------------------------------- journal
log() { # niveau message...
  local niveau="$1"; shift
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$niveau" "$*" | tee -a "$LOG"
}

rotation() { # garde les 3000 dernières lignes de chaque journal dépassant 1 Mo (sans changer d'inode)
  local f
  for f in logs/*.log; do
    [ -f "$f" ] || continue
    if [ "$(wc -c < "$f")" -gt 1048576 ]; then tail -n 3000 "$f" > "$f.tmp" && cat "$f.tmp" > "$f"; rm -f "$f.tmp"; fi
  done
}

# ---------------------------------------------------------------- e-mails
notif_mac() { # titre message : notification locale sur macOS (aucune configuration)
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"${2//\"/\'}\" with title \"${1//\"/\'}\"" >/dev/null 2>&1 || true
}

antispam() { # cle delai_en_secondes : succès seulement si le dernier envoi de cette clé est assez ancien
  local f="logs/.mail-$1" now last
  now=$(date +%s); last=$(cat "$f" 2>/dev/null || echo 0)
  [ $((now - last)) -ge "$2" ] || return 1
  echo "$now" > "$f"
}

plafond() { # cle max fenetre_en_secondes : succès tant que moins de "max" envois ont eu lieu dans la fenêtre
  local f="logs/.envois-$1" now n
  now=$(date +%s)
  touch "$f"
  awk -v t="$((now - $3))" '$1 > t' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  n=$(wc -l < "$f")
  [ "$n" -lt "$2" ] || return 1
  echo "$now" >> "$f"
}

envoyer_mail() { # destinataire sujet corps ; succès (0) si le mail est parti
  local to="$1" sujet="$2" corps="$3" fichier pass methode
  [ -n "$to" ] || return 0
  methode="${MAIL_METHOD:-}"
  [ -z "$methode" ] && [ -n "${SMTP_USER:-}" ] && methode=smtp
  fichier=$(mktemp)
  {
    printf 'From: %s\n' "${MAIL_FROM:-${SMTP_USER:-postuler@localhost}}"
    printf 'To: %s\n' "$to"
    printf 'Subject: =?UTF-8?B?%s?=\n' "$(printf '%s' "$sujet" | base64 | tr -d '\n')"
    printf 'Date: %s\n' "$(LC_ALL=C date '+%a, %d %b %Y %H:%M:%S %z')"
    printf 'MIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\n%s\n' "$corps"
  } > "$fichier"

  if [ -n "${MAIL_DRY_RUN:-}" ]; then # mode test : on écrit le mail dans un fichier au lieu de l'envoyer
    { echo "=== MAIL à $to ==="; cat "$fichier"; echo; } >> logs/mails-test.txt
    log MAIL "(test) → $to : $sujet"; rm -f "$fichier"; return 0
  fi

  if [ "$methode" = mailapp ]; then # macOS : l'application Mail envoie avec le compte déjà configuré, sans mot de passe à saisir
    rm -f "$fichier"
    if ! command -v osascript >/dev/null; then log ERREUR "MAIL_METHOD=mailapp demande macOS (osascript introuvable)."; return 1; fi
    if osascript - "$to" "$sujet" "$corps" 2>>"$LOG" <<'APPLESCRIPT'
on run argv
  set adresse to item 1 of argv
  set sujetMail to item 2 of argv
  set texteMail to item 3 of argv
  tell application "Mail"
    set m to make new outgoing message with properties {subject:sujetMail, content:texteMail & return, visible:false}
    tell m to make new to recipient at end of to recipients with properties {address:adresse}
    send m
  end tell
end run
APPLESCRIPT
    then log MAIL "envoyé à $to via Mail : $sujet"; return 0
    else log ERREUR "échec de l'envoi via Mail (compte configuré dans Mail ? autorisation « Automatisation » accordée au Terminal dans Réglages Système > Confidentialité ?)"; return 1; fi
  fi

  if [ "$methode" != smtp ] || [ -z "${SMTP_USER:-}" ] || [ -z "${SMTP_PASS:-}" ]; then
    log AVERT "e-mail non configuré : « $sujet » non envoyé à $to. Lance ./lancer.sh --config pour le régler."
    rm -f "$fichier"; return 1
  fi
  pass=${SMTP_PASS//\\/\\\\}; pass=${pass//\"/\\\"}
  # identifiants passés par stdin : ils n'apparaissent pas dans la liste des processus
  if printf 'user = "%s:%s"\n' "$SMTP_USER" "$pass" | curl -sS --max-time 40 -K - \
      --url "${SMTP_URL:-smtps://smtp.gmail.com:465}" --ssl-reqd \
      --mail-from "${MAIL_FROM:-$SMTP_USER}" --mail-rcpt "$to" -T "$fichier" 2>>"$LOG"; then
    log MAIL "envoyé à $to : $sujet"; rm -f "$fichier"; return 0
  fi
  log ERREUR "échec d'envoi de l'e-mail à $to (« $sujet ») : voir les lignes ci-dessus (mot de passe d'application ? serveur SMTP ?)"
  rm -f "$fichier"; return 1
}

diagnostic() { # état complet, joint aux alertes envoyées à l'administrateur
  echo "Heure         : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "Lien actuel   : $(cat "$LIEN_FILE" 2>/dev/null)"
  echo "Serveur local : $(curl -s -m 5 "http://127.0.0.1:$PORT/healthz" 2>/dev/null || echo 'ne répond pas')"
  echo "Système       : $(uname -sr) | node $(node -v 2>/dev/null) | $(avec_delai 5 cloudflared --version 2>&1 | head -1)"
  echo "Disque libre  : $(df -k . | awk 'NR==2 {printf "%d Mo", $4/1024}')"
  echo
  echo "--- Dernières lignes du superviseur ---"; tail -n 25 "$LOG" 2>/dev/null
  echo; echo "--- Dernières lignes du serveur ---"; tail -n 25 logs/serveur.log 2>/dev/null
  echo; echo "--- Dernières lignes du tunnel ---"; tail -n 15 logs/tunnel.log 2>/dev/null
}

alerter_admin() { # cle delai_antispam titre details
  log ALERTE "$3"
  notif_mac "Postuler" "$3"
  antispam "admin-$1" "$2" || return 0
  envoyer_mail "${MAIL_TO_ADMIN:-}" "[Postuler] $3" "$4

$(diagnostic)"
}

annoncer_lien() { # lien : à la personne qui utilise l'appli, et à l'administrateur
  local lien="$1" sujet intro
  if [ -f logs/.lien-annonce ]; then
    sujet="Postuler : NOUVEAU lien (l'ancien ne marche plus)"
    intro="Le lien de l'application a changé. L'ancien ne fonctionne plus, utilise celui-ci :"
  else
    sujet="Postuler : ton lien d'accès"
    intro="Voici le lien pour ouvrir l'application :"
  fi
  touch logs/.lien-annonce
  # chaque nouveau lien est envoyé (l'ancien est mort) ; le plafond évite l'avalanche si le tunnel boucle
  if plafond lien-user 6 3600; then
    envoyer_mail "${MAIL_TO_USER:-}" "$sujet" "Bonjour,

$intro

$lien

Ouvre-le dans Safari. Pour l'avoir sur l'écran d'accueil : Partager, puis « Sur l'écran d'accueil ».
Le code d'accès reste le même (donné séparément).

Chaque fois que le lien change, un nouveau mail est envoyé automatiquement.

Message automatique."
  fi
  if plafond lien-admin 6 3600; then
    envoyer_mail "${MAIL_TO_ADMIN:-}" "[Postuler] ${sujet#Postuler : } : $lien" "$intro

$lien

$(diagnostic)"
  fi
}

rassurer_utilisateur() { # après un plantage du serveur : le lien n'a pas changé, mais on le renvoie avec la bonne nouvelle
  local lien; lien=$(cat "$LIEN_FILE" 2>/dev/null)
  [ -n "$lien" ] || return 0
  plafond lien-user 6 3600 || return 0
  envoyer_mail "${MAIL_TO_USER:-}" "Postuler : le service est rétabli" "Bonjour,

L'application a eu un souci passager et vient de redémarrer. Le lien n'a pas changé :

$lien

Si la page ne s'ouvre pas, patiente une minute : si le lien change, un nouveau mail t'est envoyé automatiquement.

Message automatique."
}

# ---------------------------------------------------------------- assistant de configuration : ./lancer.sh --config
ecrire_reglage() { # CLE valeur : crée ou met à jour la ligne dans .env.local (lisible par toi seul)
  local cle="$1" val="$2" q
  q="'${val//\'/\'\\\'\'}'"
  touch .env.local; chmod 600 .env.local
  if grep -q "^${cle}=" .env.local; then
    K="$cle" V="$q" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] } index($0, k "=") == 1 { print k "=" v; next } { print }' .env.local > .env.local.tmp && mv .env.local.tmp .env.local
  else
    printf '%s=%s\n' "$cle" "$q" >> .env.local
  fi
  chmod 600 .env.local
}

assistant_config() {
  local v c dest
  echo "=== Réglage des e-mails ==="
  echo "Rien n'est écrit en dehors du fichier .env.local de ce dossier (ignoré par Git)."
  echo
  read -rp "Adresse qui reçoit le lien à CHAQUE nouveau lien ou plantage [${MAIL_TO_USER:-aucune}] : " v
  [ -n "$v" ] && ecrire_reglage MAIL_TO_USER "$v"
  read -rp "Ton adresse pour les alertes techniques détaillées (facultatif) [${MAIL_TO_ADMIN:-aucune}] : " v
  [ -n "$v" ] && ecrire_reglage MAIL_TO_ADMIN "$v"
  echo
  echo "Comment envoyer les mails ?"
  echo "  1) Application Mail du Mac (le plus simple : aucun mot de passe, il faut un compte déjà configuré dans Mail)"
  echo "  2) Compte Gmail (mot de passe d'application : https://myaccount.google.com/apppasswords)"
  echo "  3) Compte Outlook / Hotmail (mot de passe d'application si la validation en 2 étapes est active)"
  echo "  4) Autre serveur SMTP"
  read -rp "Choix [1] : " c
  case "${c:-1}" in
    1) ecrire_reglage MAIL_METHOD mailapp
       echo "Au premier envoi, macOS demandera d'autoriser le Terminal à contrôler Mail : accepte." ;;
    2|3|4)
      case "$c" in
        2) ecrire_reglage SMTP_URL "smtps://smtp.gmail.com:465" ;;
        3) ecrire_reglage SMTP_URL "smtp://smtp-mail.outlook.com:587" ;;
        4) read -rp "Adresse du serveur (ex. smtps://smtp.exemple.fr:465) : " v; ecrire_reglage SMTP_URL "$v" ;;
      esac
      read -rp "Adresse du compte qui ENVOIE : " v; ecrire_reglage SMTP_USER "$v"
      read -rsp "Mot de passe d'application (invisible) : " v; echo; ecrire_reglage SMTP_PASS "$v"
      ecrire_reglage MAIL_METHOD smtp ;;
    *) echo "Choix inconnu, rien changé."; return 1 ;;
  esac
  set -a; . ./.env.local; set +a
  dest="${MAIL_TO_ADMIN:-${MAIL_TO_USER:-}}"
  if [ -z "$dest" ]; then echo "Aucun destinataire réglé : pas de test."; return 0; fi
  read -rp "Envoyer un mail de test à $dest ? [O/n] " v
  case "${v:-O}" in
    [Nn]*) echo "Réglages enregistrés dans .env.local." ;;
    *) if envoyer_mail "$dest" "Postuler : test d'envoi" "Si tu lis ce message, l'envoi automatique des liens fonctionne."; then
         echo "Mail de test envoyé à $dest. Vérifie ta boîte (et les courriers indésirables)."
       else echo "L'envoi a échoué : regarde le message d'erreur ci-dessus ou dans $LOG, puis relance ./lancer.sh --config."; fi ;;
  esac
}

if [ "${1:-}" = "--config" ]; then assistant_config; exit $?; fi

# ---------------------------------------------------------------- vérifications avant démarrage
avec_delai() { # secondes commande... (perl existe sur macOS comme sur Linux)
  local s="$1"; shift
  if command -v perl >/dev/null 2>&1; then perl -e 'alarm shift; exec @ARGV' "$s" "$@"; else "$@"; fi
}

prerequis() {
  local ok=1 sortie
  log INFO "Vérification de l'installation…"

  if ! command -v node >/dev/null; then log ERREUR "node est introuvable. Installe Node 18 ou plus récent (https://nodejs.org)."; ok=0
  elif ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; then log ERREUR "Node $(node -v) est trop ancien : il faut la version 18 ou plus."; ok=0
  else log INFO "  node $(node -v) : ok"; fi

  if ! command -v cloudflared >/dev/null; then log ERREUR "cloudflared est introuvable (voir le README, section « Prérequis »)."; ok=0
  else log INFO "  cloudflared : ok"; fi

  if ! command -v "$CLAUDE_BIN" >/dev/null; then
    log ERREUR "« $CLAUDE_BIN » est introuvable. Installe Claude Code, ou indique son chemin : CLAUDE_BIN=/chemin/claude ./lancer.sh"; ok=0
  else
    mkdir -p .sandbox
    sortie=$(cd .sandbox && avec_delai 90 "$CLAUDE_BIN" -p "Réponds uniquement : ok" --tools "" --setting-sources "" --no-session-persistence 2>&1 </dev/null)
    if printf '%s' "$sortie" | grep -qi '^ok'; then log INFO "  claude répond : ok"
    elif printf '%s' "$sortie" | grep -qiE 'not logged in|/login|authentication|unauthorized|credentials|please run'; then
      log ERREUR "Claude Code n'est PAS connecté sur cet ordinateur. Ouvre un terminal, tape « claude », puis « /login », et relance ./lancer.sh."
      alerter_admin claude-auth 3600 "Claude Code n'est pas connecté" "Au démarrage, claude -p a répondu : $sortie"; ok=0
    elif printf '%s' "$sortie" | grep -qiE 'usage limit|rate.?limit|quota|overloaded|credit'; then
      log AVERT "Limite d'utilisation de Claude atteinte : l'application démarre mais les générations échoueront jusqu'au renouvellement."
      alerter_admin claude-quota 3600 "Limite d'utilisation de Claude atteinte" "Réponse : $sortie"
    else
      log AVERT "claude n'a pas répondu comme prévu (réponse : ${sortie:0:200}). L'application démarre quand même."
    fi
  fi

  if command -v lsof >/dev/null && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log ERREUR "Le port $PORT est déjà utilisé :"; lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed 's/^/    /' | tee -a "$LOG"
    log ERREUR "Arrête cet ancien programme (kill <PID>) ou choisis un autre port : PORT=3001 ./lancer.sh"; ok=0
  fi

  local libre; libre=$(df -k . | awk 'NR==2 {print int($4/1024)}')
  if [ "${libre:-0}" -lt 200 ]; then log AVERT "Espace disque faible : ${libre} Mo libres."; else log INFO "  disque : ${libre} Mo libres"; fi

  if [ -z "${CODE:-}" ]; then
    read -rsp "Choisis un code d'accès (6+ caractères) : " CODE; echo
  fi
  if [ "${#CODE}" -lt 6 ]; then log ERREUR "Le code d'accès doit faire 6 caractères au minimum."; ok=0; fi

  if [ -z "${MAIL_TO_USER:-}${MAIL_TO_ADMIN:-}" ]; then
    log INFO "  e-mails : désactivés (aucun destinataire). Pour les activer : ./lancer.sh --config"
  elif [ -n "${MAIL_DRY_RUN:-}" ]; then log INFO "  e-mails : mode test (écrits dans logs/mails-test.txt)"
  elif [ "${MAIL_METHOD:-}" = mailapp ] || { [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ]; }; then log INFO "  e-mails : actifs (${MAIL_METHOD:-smtp})"
  else log AVERT "Des destinataires sont réglés mais l'envoi ne l'est pas : aucun mail ne partira. Lance ./lancer.sh --config"; fi

  [ "$ok" = 1 ]
}

# ---------------------------------------------------------------- serveur
lancer_serveur() { # boucle : relance le serveur s'il s'arrête, avec attente croissante
  local debut crashs=0 rc attente relance=0
  while true; do
    debut=$(date +%s)
    CODE="$CODE" PORT="$PORT" CLAUDE_BIN="$CLAUDE_BIN" node server.js >> logs/serveur.log 2>&1 &
    echo $! > logs/serveur.pid
    if [ "$relance" = 1 ]; then ( attendre_serveur && log INFO "Serveur de nouveau en ligne." && rassurer_utilisateur ) & fi
    wait "$(cat logs/serveur.pid)"; rc=$?
    log ERREUR "Le serveur s'est arrêté (code $rc). Dernières lignes : $(tail -n 3 logs/serveur.log | tr '\n' ' ' | cut -c1-300)"
    if [ $(( $(date +%s) - debut )) -lt 60 ]; then crashs=$((crashs + 1)); else crashs=1; fi
    attente=$((crashs * 2)); [ "$attente" -gt 30 ] && attente=30
    [ "$rc" = 2 ] && attente=30
    if [ "$crashs" -ge 4 ]; then
      alerter_admin serveur-boucle 1800 "Le serveur plante en boucle" "Il s'est arrêté $crashs fois de suite en moins d'une minute chacune (dernier code : $rc)."
    fi
    log INFO "Redémarrage du serveur dans ${attente} s…"
    relance=1
    sleep "$attente"
  done
}

attendre_serveur() { # succès quand /healthz répond, échec au bout de 25 s
  local i
  for i in $(seq 1 25); do
    curl -sf -m 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------- tunnel
alertes_serveur() { # lit les nouvelles lignes de logs/alertes.jsonl écrites par le serveur (claude déconnecté, quota…)
  local f=logs/alertes.jsonl total ligne type detail
  [ -f "$f" ] || return 0
  total=$(wc -l < "$f")
  [ "$total" -gt "$ALERTES_LUES" ] || return 0
  while IFS= read -r ligne; do
    type=$(printf '%s' "$ligne" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')
    detail=$(printf '%s' "$ligne" | sed -n 's/.*"detail":"\(.*\)"}$/\1/p')
    case "$type" in
      auth)   alerter_admin claude-auth 3600 "Claude Code n'est plus connecté sur le serveur" "Une génération a échoué parce que Claude demande une connexion. Ouvre un terminal, tape « claude » puis « /login ».
Détail : $detail" ;;
      quota)  alerter_admin claude-quota 3600 "Limite d'utilisation de Claude atteinte" "Les générations échouent jusqu'au renouvellement de la limite.
Détail : $detail" ;;
      absent) alerter_admin claude-absent 3600 "La commande claude est introuvable" "Détail : $detail" ;;
      *)      log AVERT "alerte du serveur : $type $detail" ;;
    esac
  done < <(sed -n "$((ALERTES_LUES + 1)),${total}p" "$f")
  ALERTES_LUES=$total
}

gerer_tunnel() { # boucle : crée le tunnel, lit son journal, le relance s'il meurt ou ne répond plus
  local pid lu total ligne lien raison introuvable echecs_lien tick debut rapides=0 apres_connexion t_connecte
  local sante_base
  while true; do
    : > logs/tunnel.log
    debut=$(date +%s)
    log INFO "Création du tunnel Cloudflare…"
    cloudflared tunnel --protocol http2 --no-autoupdate --url "http://localhost:$PORT" >> logs/tunnel.log 2>&1 &
    pid=$!; echo "$pid" > logs/tunnel.pid
    lu=0; lien=""; raison=""; introuvable=0; echecs_lien=0; tick=0; t_connecte=0; : > "$LIEN_FILE"
    local dernier=$(date +%s) maintenant

    while kill -0 "$pid" 2>/dev/null && [ -z "$raison" ]; do
      sleep 2; tick=$((tick + 1)); maintenant=$(date +%s)
      # saut de temps = le Mac vient de se réveiller (ou le réseau a été suspendu)
      if [ $((maintenant - dernier)) -gt 30 ]; then log AVERT "Pause de $((maintenant - dernier)) s détectée (veille du Mac ?) : vérification de la connexion."; echecs_lien=2; fi
      dernier=$maintenant

      total=$(wc -l < logs/tunnel.log)
      if [ "$total" -gt "$lu" ]; then
        while IFS= read -r ligne; do
          case "$ligne" in
            *https://*.trycloudflare.com*)
              lien=$(printf '%s' "$ligne" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
              if [ -n "$lien" ] && [ "$(cat "$LIEN_FILE")" != "$lien" ]; then
                echo "$lien" > "$LIEN_FILE"
                printf '\n  LIEN À ENVOYER : %s\n\n' "$lien" | tee -a "$LOG"
                annoncer_lien "$lien"
              fi ;;
            *"Registered tunnel connection"*) introuvable=0; [ "$t_connecte" = 0 ] && t_connecte=$maintenant; log INFO "● Tunnel connecté" ;;
            *"Tunnel not found"*)
              introuvable=$((introuvable + 1))
              [ "$introuvable" -ge 3 ] && raison="Cloudflare a supprimé le tunnel (Tunnel not found)" ;;
            *"no recent network activity"*) log AVERT "● Réseau coupé, reconnexion automatique en cours…" ;;
            *" ERR "*) log AVERT "cloudflared : $(printf '%s' "$ligne" | cut -c1-200)" ;;
          esac
        done < <(sed -n "$((lu + 1)),${total}p" logs/tunnel.log)
        lu=$total
      fi

      # toutes les ~60 s : santé du serveur local, du lien public, alertes écrites par le serveur
      if [ $((tick % 30)) -eq 0 ]; then
        rotation
        if ! curl -sf -m 5 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
          alerter_admin serveur-local 600 "Le serveur local ne répond plus" "Le test http://127.0.0.1:$PORT/healthz a échoué. Il est relancé automatiquement s'il s'est arrêté."
        fi
        sante_base="${SANTE_BASE:-$lien}"
        # on laisse 60 s au nouveau lien pour se propager avant de le tester
        if [ -n "$sante_base" ] && [ "$t_connecte" != 0 ] && [ $((maintenant - t_connecte)) -gt 60 ]; then
          if curl -sf -m 10 "$sante_base/healthz" >/dev/null 2>&1; then echecs_lien=0
          else
            echecs_lien=$((echecs_lien + 1)); log AVERT "Le lien public ne répond pas ($echecs_lien/3)."
            [ "$echecs_lien" -ge 3 ] && raison="le lien public ne répond plus depuis 3 minutes"
          fi
        fi
      fi
      [ $((tick % 15)) -eq 0 ] && alertes_serveur
    done

    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
    [ -z "$raison" ] && raison="le processus cloudflared s'est arrêté (voir logs/tunnel.log)"
    log ERREUR "Tunnel arrêté : $raison."

    if [ $(( $(date +%s) - debut )) -lt 30 ]; then rapides=$((rapides + 1)); else rapides=0; fi
    if [ "$rapides" -ge 3 ]; then
      alerter_admin tunnel-instable 1800 "Le tunnel ne tient pas" "Il s'arrête moins de 30 secondes après son démarrage ($rapides fois de suite). Dernière raison : $raison. Vérifie la connexion Internet du Mac."
    else
      alerter_admin tunnel-relance 300 "Tunnel relancé : $raison" "Le tunnel a été recréé. La personne reçoit automatiquement le nouveau lien par e-mail si MAIL_TO_USER est réglé."
    fi
    sleep $(( rapides >= 3 ? 30 : 3 ))
  done
}

# ---------------------------------------------------------------- démarrage
arreter() {
  trap - EXIT INT TERM
  log INFO "Arrêt…"
  local f
  for f in logs/tunnel.pid logs/serveur.pid; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
  done
  [ -n "${SERVEUR_LOOP:-}" ] && kill "$SERVEUR_LOOP" 2>/dev/null
  exit 0
}
trap arreter EXIT INT TERM

log INFO "=== Postuler : démarrage ==="
if ! prerequis; then
  log ERREUR "Corrige les points ci-dessus puis relance ./lancer.sh. Détails dans $LOG."
  trap - EXIT INT TERM; exit 1
fi
export CODE PORT

# macOS : empêche la veille tant que le script tourne (écran, disque, système sur secteur)
if command -v caffeinate >/dev/null; then caffeinate -dims -w $$ & fi

ALERTES_LUES=0; [ -f logs/alertes.jsonl ] && ALERTES_LUES=$(wc -l < logs/alertes.jsonl)

lancer_serveur & SERVEUR_LOOP=$!
if attendre_serveur; then log INFO "Serveur prêt sur http://localhost:$PORT"
else
  log ERREUR "Le serveur ne répond pas après 25 s. Dernières lignes de logs/serveur.log :"; tail -n 15 logs/serveur.log | sed 's/^/    /' | tee -a "$LOG"
  alerter_admin demarrage 600 "Le serveur n'a pas démarré" "Aucune réponse de /healthz après 25 s."
  exit 1
fi

echo "Ctrl+C pour tout arrêter. Le lien à envoyer s'affiche ci-dessous dès que le tunnel est prêt."
gerer_tunnel
