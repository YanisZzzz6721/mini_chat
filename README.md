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

## Onglet Candidature (lettre + CV depuis une offre)
1. **Profil** : saisir un nom de profil (ex : `anass`, toujours le même), importer son CV (PDF, Word ou texte) ou le coller. Claude le transforme en profil structuré que le candidat relit, corrige et enregistre. Réglages d'écriture : ton, longueur max de la lettre (1500 par défaut), pas de tiret long, consignes perso.
2. **Offre** : coller le texte de l'annonce Indeed, puis « Générer ».
3. **Résultat** : score de compatibilité avec mots-clés trouvés / manquants, lettre (copier ou .docx), CV adapté (copier ou PDF). Les textes restent modifiables avant copie ou export.

Garde-fous : seuls les faits du profil sont utilisés (rien d'inventé), les tirets longs et le dépassement de longueur sont corrigés côté serveur. Les profils sont stockés dans `data/profils/` sur ton ordinateur, exclus de Git. Toute personne qui a le code d'accès et connaît un nom de profil peut le lire : ne partage le code qu'avec des gens de confiance. Les prompts sont dans `prompt-profil.md` et `prompt-candidature.md`.

## Personnaliser l'assistant
Édite `prompt-systeme.md` (rôle, ton, limites). Pris en compte à chaque message, sans relancer.

## Sécurité
- Code d'accès obligatoire ; 10 essais ratés / 10 min → blocage de l'IP.
- Claude tourne **sans aucun outil** (`--tools ""`), sans réglages ni skills, dans le dossier vide `.sandbox/` : il ne voit pas ton vault.
- Limites : 6 messages/min et 200/jour par IP, 2 requêtes en parallèle, 4000 caractères max (réglables : `LIMITE_PAR_MINUTE`, `LIMITE_PAR_JOUR`, `MAX_PARALLELE`).
- Chaque message consomme ton abonnement Claude. Ton ordinateur doit rester allumé (`lancer.sh` empêche la veille sur macOS).
- Variables : `PORT`, `MODEL`, `CLAUDE_BIN`.
