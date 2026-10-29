// Journal horodaté, classement des échecs de claude, alertes lues par lancer.sh (logs/alertes.jsonl).
const fs = require('fs');
const path = require('path');

const LOGS = path.join(__dirname, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (niveau, msg) => console.log(`${ts()} [${niveau}] ${msg}`);

// Cause probable d'un échec de claude -p, message pour l'utilisateur, et si l'administrateur doit être prévenu.
function classer(stderr = '', timeout = false) {
  const s = String(stderr);
  if (timeout) return { type: 'timeout', alerte: false, message: 'La réponse a pris trop de temps. Réessaie.' };
  if (/introuvable|ENOENT/i.test(s)) return { type: 'absent', alerte: true, message: 'Claude n’est pas installé sur le serveur. L’administrateur a été prévenu.' };
  if (/not logged in|\/login|invalid api key|authentication|unauthorized|oauth|credentials|please run/i.test(s)) return { type: 'auth', alerte: true, message: 'Le service n’est plus connecté à Claude. L’administrateur a été prévenu.' };
  if (/usage limit|rate.?limit|quota|too many requests|\b429\b|overloaded|\b529\b|credit/i.test(s)) return { type: 'quota', alerte: true, message: 'Limite d’utilisation de Claude atteinte pour le moment. Réessaie plus tard.' };
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|fetch failed|getaddrinfo/i.test(s)) return { type: 'reseau', alerte: false, message: 'Claude est injoignable (réseau). Réessaie dans un instant.' };
  return { type: 'inconnu', alerte: false, message: 'Erreur côté serveur, réessaie.' };
}

function alerte(type, detail) {
  try { fs.appendFileSync(path.join(LOGS, 'alertes.jsonl'), JSON.stringify({ t: new Date().toISOString(), type, detail: String(detail).slice(0, 300) }) + '\n'); } catch {}
}

module.exports = { log, classer, alerte };
