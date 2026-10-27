---
titre: Mini chat web piloté par Claude Code
tags: [outils, mini-chat, claude-code]
date: 2026-10-27
statut: actif
---
# Mini chat web → `claude -p`

Une page web (iPhone, plein écran) qui envoie les messages à `claude -p` sur **ton ordinateur**, via un tunnel Cloudflare gratuit. Aucun déploiement.

## Prérequis (sur ton Mac ou ton Fedora)
- Node ≥ 18 et Claude Code connecté (`claude` fonctionne dans le terminal).
- `cloudflared` :
  - macOS : `brew install cloudflared`
  - Fedora : télécharge le `.rpm` depuis les releases de `cloudflare/cloudflared` sur GitHub, puis `sudo dnf install ./cloudflared-*.rpm`

## Lancer
```bash
git clone https://github.com/YanisZzzz6721/mini_chat   # la première fois ; ensuite : git pull
cd mini_chat
./lancer.sh
```
Le terminal affiche un lien `https://xxxx.trycloudflare.com` : envoie-le avec le code d'accès. Le lien change à chaque lancement. `Ctrl+C` coupe tout.

## Sur l'iPhone
Ouvrir le lien dans **Safari** → Partager → **Sur l'écran d'accueil**. L'appli s'ouvre ensuite en plein écran. Si le lien change, refais l'ajout.

## Personnaliser l'assistant
Édite `prompt-systeme.md` (rôle, ton, limites). Pris en compte à chaque message, sans relancer.

## Sécurité
- Code d'accès obligatoire ; 10 essais ratés / 10 min → blocage de l'IP.
- Claude tourne **sans aucun outil** (`--tools ""`), sans réglages ni skills, dans le dossier vide `.sandbox/` : il ne voit pas ton vault.
- Limites : 6 messages/min et 200/jour par IP, 2 requêtes en parallèle, 4000 caractères max (réglables : `LIMITE_PAR_MINUTE`, `LIMITE_PAR_JOUR`, `MAX_PARALLELE`).
- Chaque message consomme ton abonnement Claude. Ton ordinateur doit rester allumé (`lancer.sh` empêche la veille sur macOS).
- Variables : `PORT`, `MODEL`, `CLAUDE_BIN`.
