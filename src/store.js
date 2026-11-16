// Stockage très simple dans un fichier JSON local.
const fs = require('fs');
const path = require('path');

const os = require('os');

// Les données (paris, réglages, historique) sont rangées en dehors du dossier
// de l'app (~/.ecarts-cotes/db.json) : une mise à jour ou un nouveau
// téléchargement de l'app ne les efface jamais.
const LEGACY_FILE = path.join(__dirname, '..', 'data', 'db.json');
const FILE = process.env.DB_FILE || path.join(os.homedir(), '.ecarts-cotes', 'db.json');

// Récupère automatiquement les données d'une ancienne version (data/db.json)
if (!process.env.DB_FILE && !fs.existsSync(FILE) && fs.existsSync(LEGACY_FILE)) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.copyFileSync(LEGACY_FILE, FILE);
  console.log(`  Données reprises depuis ${LEGACY_FILE}`);
}

const DEFAULTS = {
  settings: {
    sports: ['football', 'tennis', 'basket'],
    dayOffset: 0,
    maxMatches: 40,
    concurrency: 3,
    alertGapPct: 8,
    alertGroups: ['main'],
    autoScanMinutes: 0,
    bankroll: 100,
    kellyFraction: 0.25,
  },
  lastScan: null,
  history: {},
  alerts: [],
  bets: [],
  version: 2,
};

let db = null;

function load() {
  if (db) return db;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) }, version: raw.version || 1 };
  } catch {
    db = structuredClone(DEFAULTS);
  }
  // v2 : tennis et basket ajoutés aux sports scannés
  if (!(db.version >= 2)) {
    for (const sp of ['tennis', 'basket']) if (!db.settings.sports.includes(sp)) db.settings.sports.push(sp);
    db.version = 2;
    save();
  }
  return db;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  }, 200);
}

// Remplace les données par une sauvegarde (import)
function replace(data) {
  db = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) }, version: 2 };
  save();
  return db;
}

module.exports = { load, save, replace, FILE };
