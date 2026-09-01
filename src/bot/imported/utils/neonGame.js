/**
 * NeonGame — Mini-jeu automatique toutes les 2h
 * Nebula Bot by Dark Neon
 *
 * Fonctionnement :
 *  - Toutes les 2h, envoie un emoji OU un mot difficile dans tous les groupes actifs
 *  - Les joueurs ont 5 minutes pour répondre avec .me <emoji_ou_mot>
 *  - Premier à répondre correctement gagne des coins
 *  - 3 victoires consécutives = +5000 🪙 bonus
 */

const fs   = require('fs');
const path = require('path');
const eco  = require('./economy');

const DB_PATH    = path.join(__dirname, '../database');
const GAME_FILE  = path.join(DB_PATH, 'neongame.json');

if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
if (!fs.existsSync(GAME_FILE)) fs.writeFileSync(GAME_FILE, JSON.stringify({ sessions: {}, streaks: {}, usedEmojis: [], usedWords: [] }, null, 2));

// ── I/O ───────────────────────────────────────────────────────────────────────

function readDB()      { try { return JSON.parse(fs.readFileSync(GAME_FILE, 'utf8')); } catch { return { sessions: {}, streaks: {}, usedEmojis: [], usedWords: [] }; } }
function writeDB(data) { fs.writeFileSync(GAME_FILE, JSON.stringify(data, null, 2)); }

// ── EMOJIS (tous ceux du clavier WhatsApp/standard) ──────────────────────────

const ALL_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
  '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬',
  '🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','💫','🤯','🤠','🥳',
  '🥸','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
  '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻',
  '👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙈','🙉','🙊','💋','💌','💘','💝','💖',
  '💗','💓','💞','💕','💟','❣️','💔','❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💯','💢','💥','💫',
  '💦','💨','🕳️','💬','💭','💤','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈',
  '👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳',
  '💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦','👶','🧒',
  '👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷',
  '👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🫃','🫄','🤱','👼','🎅','🤶',
  '🧙','🧝','🧛','🧟','🧞','🧜','🧚','🧑‍🎄','🦸','🦹','🧑‍⚕️','👩‍⚕️','👨‍⚕️','🐶','🐱','🐭','🐹','🐰','🦊','🐻',
  '🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦅','🦆','🦉','🦇','🐺','🐗','🐴','🦄',
  '🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🦎','🐍','🐲','🦕','🦖','🦎','🦑','🦐','🦞',
  '🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫',
  '🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛',
  '🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔',
  '🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🍄','🌾','💐','🌷','🌹','🥀',
  '🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌟','⭐',
  '🌠','🌌','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','🌊','🔥',
  '⚡','🌈','☀️','🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🫒','🥑','🍆',
  '🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥕','🌽','🫚','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖',
  '🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥚','🍜','🍝','🍛','🍲','🍱','🍣','🍱','🍤','🍙','🍚',
  '🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋',
  '☕','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏',
  '🎱','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌',
  '🎿','⛷️','🏂','🪂','🏋️','🤸','🤼','🤺','⛹️','🤾','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚴','🏆','🥇',
  '🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺',
  '🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩','🚗','🚕','🚙','🏎️','🚓','🚑','🚒','🚐','🛻','🚚',
  '✈️','🛩️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇',
  '🗺️','🌍','🌎','🌏','🌐','🗾','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱',
  '🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰',
  '💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️',
  '⌚','📱','💻','🖥️','⌨️','🖱️','🖨️','📷','📸','📹','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🧭','⏰',
  '⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🧱','💎','🔧','🔨','⚒️','🛠️','🔑','🗝️','🔒','🔓','🚪','🪑',
];

// ── MOTS DIFFICILES ───────────────────────────────────────────────────────────

const HARD_WORDS = [
  'Anticonstitutionnellement', 'Prestidigitateur', 'Hippopotomonstrosesquipedaliophobie',
  'Onomatopée', 'Chrysanthème', 'Cacophonie', 'Épistémologie', 'Circonspect',
  'Vraisemblablement', 'Perpendiculaire', 'Schadenfreude', 'Déontologique',
  'Mnémotechnique', 'Ophthalmologiste', 'Psychothérapeutique', 'Développement',
  'Bureaucratique', 'Contemporain', 'Extraordinaire', 'Parallélépipède',
  'Invraisemblable', 'Consubstantiel', 'Irréductibilité', 'Amphithéâtre',
  'Révolutionnaire', 'Immédiatement', 'Perpétuellement', 'Magnifiquement',
  'Philosophique', 'Gastronomique', 'Authentiquement', 'Catastrophique',
  'Précautionneusement', 'Incompréhensible', 'Invulnérabilité', 'Caractéristique',
  'Conscientieusement', 'Approximativement', 'Extraordinairement', 'Linguistique',
  'Systématiquement', 'Démocratiquement', 'Technologiquement', 'Environnemental',
  'Interconnexion', 'Microprocesseur', 'Photosynthèse', 'Métabolisme',
  'Électromagnétique', 'Thermodynamique', 'Aérodynamique', 'Psychologique',
  'Anthropologique', 'Biomécanique', 'Nanotechnologie', 'Cybersécurité',
  'Algorithme', 'Cryptographie', 'Perpétuité', 'Simultanément',
  // Mots en langues étrangères connus en Afrique
  'Ngambi', 'Tokwak', 'Njangui', 'Mbimbili', 'Benskin', 'Kossam',
  'Quartier', 'Ndolo', 'Makossa', 'Bikutsi', 'Essébé', 'Mvom',
];

const GAME_REWARD_BASE   = 200;  // coins pour avoir répondu juste
const STREAK_BONUS       = 5000; // bonus à 3 victoires consécutives
const GAME_WINDOW        = 5 * 60 * 1000; // 5 minutes

// ── Sessions actives : Map<groupId, { answer, type, expiresAt, timeout }> ─────
const activeSessions = new Map();

// ── Obtenir la prochaine question ─────────────────────────────────────────────

function getNextChallenge() {
  const db = readDB();

  // Décider emoji ou mot (50/50)
  const useEmoji = Math.random() < 0.5;

  if (useEmoji) {
    let pool = ALL_EMOJIS.filter(e => !(db.usedEmojis || []).includes(e));
    if (pool.length === 0) {
      // Tous utilisés → reset
      db.usedEmojis = [];
      pool = ALL_EMOJIS;
    }
    const emoji = pool[Math.floor(Math.random() * pool.length)];
    db.usedEmojis = [...(db.usedEmojis || []), emoji];
    writeDB(db);
    return { type: 'emoji', answer: emoji, display: emoji };
  } else {
    let pool = HARD_WORDS.filter(w => !(db.usedWords || []).includes(w));
    if (pool.length === 0) {
      db.usedWords = [];
      pool = HARD_WORDS;
    }
    const word = pool[Math.floor(Math.random() * pool.length)];
    db.usedWords = [...(db.usedWords || []), word];
    writeDB(db);
    return { type: 'word', answer: word, display: `*${word}*` };
  }
}

// ── Lancer une session dans un groupe ─────────────────────────────────────────

function startSession(groupId, challenge) {
  const expiresAt = Date.now() + GAME_WINDOW;
  const timeout   = setTimeout(() => {
    activeSessions.delete(groupId);
  }, GAME_WINDOW);

  activeSessions.set(groupId, { ...challenge, expiresAt, timeout });
}

function getSession(groupId) {
  return activeSessions.get(groupId) || null;
}

function endSession(groupId) {
  const s = activeSessions.get(groupId);
  if (s?.timeout) clearTimeout(s.timeout);
  activeSessions.delete(groupId);
}

// ── Valider une réponse ───────────────────────────────────────────────────────

function checkAnswer(groupId, userId, answer) {
  const session = getSession(groupId);
  if (!session) return { ok: false, reason: 'no_session' };
  if (Date.now() > session.expiresAt) {
    endSession(groupId);
    return { ok: false, reason: 'expired' };
  }

  const correct = session.type === 'emoji'
    ? answer.trim() === session.answer.trim()
    : answer.trim().toLowerCase() === session.answer.toLowerCase();

  if (!correct) return { ok: false, reason: 'wrong', correct: session.answer };

  endSession(groupId);
  return { ok: true, session };
}

// ── Gestion des streaks ────────────────────────────────────────────────────────

function recordWin(userId) {
  const db = readDB();
  if (!db.streaks) db.streaks = {};
  db.streaks[userId] = (db.streaks[userId] || 0) + 1;
  const streak = db.streaks[userId];
  writeDB(db);
  return streak;
}

function resetStreak(userId) {
  const db = readDB();
  if (!db.streaks) db.streaks = {};
  db.streaks[userId] = 0;
  writeDB(db);
}

function getStreak(userId) {
  const db = readDB();
  return (db.streaks || {})[userId] || 0;
}

module.exports = {
  getNextChallenge, startSession, getSession, endSession, checkAnswer,
  recordWin, resetStreak, getStreak,
  ALL_EMOJIS, HARD_WORDS, GAME_REWARD_BASE, STREAK_BONUS, GAME_WINDOW,
};
