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
cp .env.local.example .env.local                      # une seule fois, puis remplis-le (voir plus bas)
./lancer.sh
```
Le terminal affiche un cadre **LIEN À ENVOYER**. `Ctrl+C` coupe tout.

## Superviseur : relance automatique, diagnostic, e-mails
`lancer.sh` ne se contente pas de lancer : il surveille et répare.

**Avant de démarrer**, il vérifie et explique chaque problème avec la solution : Node 18+, `cloudflared`, `claude` installé **et connecté** (un vrai test), port libre, espace disque, code d'accès, réglages e-mail.

**Pendant le fonctionnement**
- Le **serveur** qui plante est relancé (attente croissante). S'il plante en boucle, l'administrateur est prévenu.
- Le **tunnel** est recréé s'il meurt, si Cloudflare le supprime (`Tunnel not found`), ou si le lien public ne répond plus pendant 3 minutes. Un Mac qui se réveille est détecté.
- Les échecs de Claude sont classés (déconnecté, limite d'utilisation atteinte, réseau, délai dépassé après 4 minutes) : l'utilisateur voit un message clair, l'administrateur reçoit une alerte si c'est à lui d'agir.
- Une erreur inattendue du serveur est journalisée avec sa pile d'appels, puis le serveur est relancé.

**Journaux** (dossier `logs/`, ignoré par Git, tronqués au-delà de 1 Mo) : `superviseur.log`, `serveur.log` (une ligne par requête, sans le contenu des lettres), `tunnel.log`, `alertes.jsonl`. Sur macOS, une notification locale s'affiche aussi à chaque alerte.

**E-mails** (facultatif). Le plus simple : `./lancer.sh --config`, un assistant qui pose les questions (adresse qui reçoit le lien, méthode d'envoi : application Mail du Mac sans mot de passe, ou Gmail / Outlook / autre SMTP), crée `.env.local` (lisible par toi seul) et envoie un mail de test.
- `MAIL_TO_USER` : reçoit **le lien** à chaque nouveau lien (« NOUVEAU lien, l'ancien ne marche plus ») et un mail « service rétabli » avec le lien après un plantage du serveur, sans détail technique et **jamais le code d'accès**. Plafonné à 6 mails par heure si ça boucle.
- `MAIL_TO_ADMIN` : reçoit les alertes techniques avec un diagnostic complet (état, versions, dernières lignes des journaux) : nouveau lien, tunnel relancé, tunnel instable, serveur en panne, Claude déconnecté ou limite atteinte, échec au démarrage. Un délai anti-spam évite les doublons.
- L'envoi passe par SMTP avec un compte à toi (par exemple Gmail avec un « mot de passe d'application »). Les identifiants restent dans `.env.local` et ne sont pas visibles dans la liste des processus.
- Pour tester sans rien envoyer : `MAIL_DRY_RUN=1 ./lancer.sh` écrit les mails dans `logs/mails-test.txt`.

Le lien Cloudflare gratuit change à chaque recréation : c'est pour ça que le nouveau lien part automatiquement par e-mail. Pour un lien fixe, il faut un tunnel nommé (compte Cloudflare gratuit + nom de domaine). Laisse le Mac branché et éveillé : `lancer.sh` empêche la veille tant qu'il tourne, mais pas la fermeture du capot.

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

## Personnaliser
Les prompts sont dans `prompt-profil.md`, `prompt-candidature.md`, `prompt-retouche.md`, `prompt-preferences.md` et `prompt-coach.md` (pris en compte sans relancer).

## Sécurité
- Code d'accès obligatoire ; 10 essais ratés / 10 min → blocage de l'IP.
- Claude tourne **sans aucun outil** (`--tools ""`), sans réglages ni skills, dans le dossier vide `.sandbox/` : il ne voit pas ton vault.
- Limites : 6 messages/min et 200/jour par IP, 2 requêtes en parallèle, 4000 caractères max (réglables : `LIMITE_PAR_MINUTE`, `LIMITE_PAR_JOUR`, `MAX_PARALLELE`).
- Chaque message consomme ton abonnement Claude. Ton ordinateur doit rester allumé (`lancer.sh` empêche la veille sur macOS).
- Variables : `PORT`, `MODEL`, `CLAUDE_BIN`, `CLAUDE_TIMEOUT_S`.
