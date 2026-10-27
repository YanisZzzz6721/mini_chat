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

## Application Postuler (mobile)
Quatre onglets : **Postuler**, **Historique**, **Profil**, **Chat**.

1. **Profil** (une seule fois) : nom de profil (ex : `anass`), import du CV (PDF, Word, texte ou collé), relecture du profil structuré, réglages d'écriture (ton, longueur max, pas de tiret long).
2. **Postuler** : coller l'annonce Indeed, « Générer ». Résultat en plein écran : lettre, CV adapté, score avec mots-clés manquants, annonce. Boutons **Copier** (priorité) et téléchargement (lettre .docx, CV PDF).
3. **Retoucher** : sous la lettre ou le CV, des puces (« Plus court »…) ou une consigne libre. Claude réécrit, et si la consigne vaut pour l'avenir (ton, longueur, ce qu'il ne faut jamais dire), elle est mémorisée.
4. **Historique** : toutes les candidatures, recherche, statut (brouillon, envoyée, réponse, entretien, refus), versions successives avec retour en arrière, suppression.

### Mémoire (fichiers `.md` sur ton ordinateur, hors Git)
```
data/profils/<nom>/
  profil.md             faits du candidat, seule source de vérité
  prefs.json            réglages
  preferences.md        préférences apprises des retouches (20 puces max, résumées par Claude)
  historique/<date-entreprise>/
    candidature.md      état courant : offre, score, lettre, CV
    versions/vNNN-*.md  une version par changement
```
Chaque nouvelle lettre reçoit : le profil, `preferences.md`, et les 3 lettres passées les plus proches de l'offre (pour le ton). Le reste de l'historique reste sur disque et n'est pas envoyé à Claude, donc rien ne grossit. Ces dossiers sont lisibles et modifiables à la main, par exemple dans Obsidian.

Garde-fous : seuls les faits du profil sont utilisés (rien d'inventé) ; tirets longs et dépassement de longueur sont corrigés côté serveur. Toute personne qui a le code d'accès et connaît un nom de profil peut le lire : ne partage le code qu'avec des gens de confiance. Prompts modifiables : `prompt-profil.md`, `prompt-candidature.md`, `prompt-retouche.md`, `prompt-preferences.md`.

## Personnaliser l'assistant
Édite `prompt-systeme.md` (rôle, ton, limites). Pris en compte à chaque message, sans relancer.

## Sécurité
- Code d'accès obligatoire ; 10 essais ratés / 10 min → blocage de l'IP.
- Claude tourne **sans aucun outil** (`--tools ""`), sans réglages ni skills, dans le dossier vide `.sandbox/` : il ne voit pas ton vault.
- Limites : 6 messages/min et 200/jour par IP, 2 requêtes en parallèle, 4000 caractères max (réglables : `LIMITE_PAR_MINUTE`, `LIMITE_PAR_JOUR`, `MAX_PARALLELE`).
- Chaque message consomme ton abonnement Claude. Ton ordinateur doit rester allumé (`lancer.sh` empêche la veille sur macOS).
- Variables : `PORT`, `MODEL`, `CLAUDE_BIN`.
