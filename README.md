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
Design noir inspiré de Vercel (Geist, angles à 6 px, boutons principaux bleu diamant, secondaires bleu nuit). Trois onglets : **Postuler**, **Coach**, **Profil**.

1. **Profil** (une seule fois) : nom de profil (ex : `anass`), import du CV (PDF, Word, texte) ou d'une fiche `.md` complète, relecture, règles de rédaction, réglages d'écriture (ton, longueur max, pas de tiret long).
2. **Postuler** : coller l'annonce Indeed, « Générer ». Résultat en plein écran : lettre (modifiable), CV au design colonne latérale, score avec points couverts / à renforcer. Boutons **Copier** (priorité) et téléchargement (lettre .docx, CV PDF). La liste **Candidatures** est sous la zone d'annonce (recherche, statut, versions).
3. **Retoucher** : sous la lettre ou le CV, des consignes rapides ou libres. Claude réécrit, et si la consigne vaut pour l'avenir (ton, longueur, ce qu'il ne faut jamais dire), elle est mémorisée.
4. **Coach** : un chat qui connaît le profil, les règles et la candidature ouverte (menu ⋯ d'une candidature, « Préparer l'entretien ») : questions d'entretien avec réponses tirées des vrais faits, relances, réponses à un recruteur.

### Fiche complète d'un candidat (données « en dur » en .md)
Deux façons de donner à l'appli une fiche `.md` complète (faits vérifiés, règles de rédaction, notes) :
- coller la fiche dans l'écran Profil, « J'ai déjà une fiche complète » ;
- ou déposer le fichier à la main dans `data/profils/<nom>/fiche.md` : il est importé au premier chargement.

Elle est découpée automatiquement : les sections « Règles de rédaction » deviennent `regles.md` (consignes impératives, injectées à chaque génération, plus fortes que l'annonce), les sections « Livrables », « Reste à confirmer », « Plan habilitation », « Prochaines étapes » et l'en-tête vont dans `notes.md` (jamais envoyées à Claude), le reste est `profil.md`. Tout ce qui est marqué « à confirmer », « inconnu » ou « supposé » n'est jamais affirmé dans une lettre ou un CV. Cette fiche contient des données personnelles : le dossier `data/` est exclu de Git, et ne la commite jamais dans ce dépôt public.

### Mémoire (fichiers `.md` sur ton ordinateur, hors Git)
```
data/profils/<nom>/
  profil.md             faits du candidat, seule source de vérité
  prefs.json            réglages
  fiche.md              fiche complète d'origine (si importée)
  regles.md             règles de rédaction impératives
  notes.md              notes internes, non envoyées à Claude
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
