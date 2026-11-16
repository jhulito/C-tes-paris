// Stockage très simple dans un fichier JSON local (data/db.json).
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

const DEFAULTS = {
  settings: {
    sports: ['football'],
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
};

let db = null;

function load() {
  if (db) return db;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { ...structuredClone(DEFAULTS), ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch {
    db = structuredClone(DEFAULTS);
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

module.exports = { load, save };
