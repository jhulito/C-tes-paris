// Charge un éventuel fichier .env (ANTHROPIC_API_KEY=..., PORT=...)
try {
  const envFile = require('path').join(__dirname, '..', '.env');
  for (const line of require('fs').readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const path = require('path');
const express = require('express');
const store = require('./store');
const scraper = require('./scraper');
const { analyze, kelly, MARKET_GROUPS, BOOK_KEYS } = require('./analysis');
const { streamChat, MODEL } = require('./chat');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const db = store.load();

// ---------- Analyse (mise en cache par scan) ----------
let cache = { at: null, data: null };
function currentAnalysis() {
  if (!db.lastScan) return null;
  if (cache.at !== db.lastScan.at) {
    const data = analyze(db.lastScan.matches);
    // Variation de la meilleure cote depuis le scan précédent
    for (const s of data.selections) {
      const h = db.history[s.key];
      if (h && h.length >= 2) {
        const prev = h[h.length - 2];
        const prevBest = Math.max(...Object.values(prev.o));
        s.prevBest = prevBest;
        s.sinceLastPct = Math.round((s.best / prevBest - 1) * 10000) / 100;
      }
    }
    cache = { at: db.lastScan.at, data };
  }
  return cache.data;
}

// ---------- Scan ----------
let scanState = { running: false, progress: null, error: null, startedAt: null };

async function runScan(opts = {}) {
  if (scanState.running) return false;
  const s = { ...db.settings, ...opts };
  scanState = { running: true, progress: { phase: 'start' }, error: null, startedAt: Date.now() };
  (async () => {
    try {
      const res = await scraper.scan({
        sports: s.sports,
        dayOffset: Number(s.dayOffset) || 0,
        maxMatches: Number(s.maxMatches) || 40,
        concurrency: Number(s.concurrency) || 3,
        onProgress: (p) => (scanState.progress = p),
      });
      const at = new Date().toISOString();
      db.lastScan = { at, sports: s.sports, dayOffset: s.dayOffset, geo: res.geo, errors: res.errors.slice(0, 50), matches: res.matches };

      // Historique : meilleure cote de chaque book par sélection et par scan
      const a = analyze(res.matches);
      const t = Date.now();
      for (const sel of a.selections) {
        const h = (db.history[sel.key] ||= []);
        h.push({ t, o: sel.odds });
        if (h.length > 40) h.splice(0, h.length - 40);
      }
      // Nettoyage : on oublie les sélections non vues depuis 3 jours
      for (const [k, h] of Object.entries(db.history)) if (t - h[h.length - 1].t > 3 * 864e5) delete db.history[k];

      // Alertes : nouvelles sélections au-dessus du seuil
      const known = new Set(db.alerts.map((x) => x.key + '@' + x.best));
      for (const sel of a.selections) {
        if (sel.gapPct < db.settings.alertGapPct || !db.settings.alertGroups.includes(sel.group)) continue;
        const id = sel.key + '@' + sel.best;
        if (known.has(id)) continue;
        db.alerts.push({ id: `${t}-${db.alerts.length}`, t, key: sel.key, best: sel.best, kind: 'gap', title: `${sel.home} - ${sel.away}`, text: `${sel.market} · ${sel.outcomeLabel} : ${sel.best} chez ${label(sel.bestBook)} (écart ${sel.gapPct}%)` });
      }
      for (const sb of a.surebets.filter((x) => x.isArb)) {
        const id = `${sb.matchId}|${sb.market}|arb@${sb.sumInv}`;
        if (known.has(id)) continue;
        db.alerts.push({ id: `${t}-${db.alerts.length}`, t, key: `${sb.matchId}|${sb.market}|arb`, best: sb.sumInv, kind: 'surebet', title: `Surebet ${sb.home} - ${sb.away}`, text: `${sb.market} : +${sb.profitPct}% garanti` });
      }
      if (db.alerts.length > 300) db.alerts.splice(0, db.alerts.length - 300);
      store.save();
      scanState.progress = { phase: 'done', total: res.matches.length };
    } catch (e) {
      console.error(e);
      scanState.error = e.message;
    } finally {
      scanState.running = false;
    }
  })();
  return true;
}

const label = (b) => ({ winamax: 'Winamax', unibet: 'Unibet', betclic: 'Betclic' })[b] || b;

let autoTimer = null;
function scheduleAuto() {
  clearInterval(autoTimer);
  const m = Number(db.settings.autoScanMinutes);
  if (m > 0) autoTimer = setInterval(() => runScan(), Math.max(5, m) * 60000);
}
scheduleAuto();

// ---------- API ----------
app.get('/api/meta', (req, res) => {
  res.json({
    sports: scraper.SPORTS,
    groups: MARKET_GROUPS,
    books: BOOK_KEYS,
    settings: db.settings,
    model: MODEL,
    lastScan: db.lastScan && { at: db.lastScan.at, sports: db.lastScan.sports, geo: db.lastScan.geo, errors: db.lastScan.errors, matches: db.lastScan.matches.length },
    scan: scanState,
  });
});

app.put('/api/settings', (req, res) => {
  const allowed = Object.keys(db.settings);
  for (const k of allowed) if (k in req.body) db.settings[k] = req.body[k];
  store.save();
  scheduleAuto();
  res.json(db.settings);
});

app.post('/api/scan', async (req, res) => {
  const started = await runScan(req.body || {});
  res.json({ started, scan: scanState });
});

app.get('/api/scan', (req, res) => res.json(scanState));

app.get('/api/analysis', (req, res) => {
  const a = currentAnalysis();
  if (!a) return res.json({ empty: true });
  res.json({ at: db.lastScan.at, geo: db.lastScan.geo, ...a });
});

app.get('/api/history', (req, res) => res.json(db.history[req.query.key] || []));

app.get('/api/alerts', (req, res) => {
  const since = Number(req.query.since) || 0;
  res.json(db.alerts.filter((a) => a.t > since).slice(-100));
});

app.get('/api/kelly', (req, res) => {
  const odd = Number(req.query.odd), prob = Number(req.query.prob) / 100;
  const f = kelly(odd, prob, Number(req.query.fraction) || db.settings.kellyFraction);
  res.json({ fraction: f, stake: Math.round(f * db.settings.bankroll * 100) / 100 });
});

// Journal de paris
app.get('/api/bets', (req, res) => res.json(db.bets));
app.post('/api/bets', (req, res) => {
  const b = req.body || {};
  const bet = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: new Date().toISOString(),
    event: String(b.event || ''),
    selection: String(b.selection || ''),
    book: String(b.book || ''),
    odd: Number(b.odd) || 0,
    stake: Number(b.stake) || 0,
    fairOdd: b.fairOdd ? Number(b.fairOdd) : null,
    key: b.key || null,
    status: 'pending',
    closingOdd: null,
  };
  db.bets.push(bet);
  store.save();
  res.json(bet);
});
app.patch('/api/bets/:id', (req, res) => {
  const bet = db.bets.find((x) => x.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'introuvable' });
  for (const k of ['status', 'closingOdd', 'stake', 'odd', 'selection', 'event', 'book']) if (k in req.body) bet[k] = req.body[k];
  store.save();
  res.json(bet);
});
app.delete('/api/bets/:id', (req, res) => {
  db.bets = db.bets.filter((x) => x.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

// Export CSV des écarts
app.get('/api/export.csv', (req, res) => {
  const a = currentAnalysis();
  const rows = [['Sport', 'Compétition', 'Heure', 'Match', 'Marché', 'Sélection', 'Winamax', 'Unibet', 'Betclic', 'Meilleure', 'Book', 'Écart %', 'Cote juste', 'Value %']];
  for (const s of a?.selections || []) {
    rows.push([s.sport, s.league, s.time, `${s.home} - ${s.away}`, s.market, s.outcomeLabel, s.odds.winamax ?? '', s.odds.unibet ?? '', s.odds.betclic ?? '', s.best, label(s.bestBook), s.gapPct, s.fairOdd ?? '', s.valuePct ?? '']);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ecarts-cotes.csv"');
  res.send('﻿' + csv);
});

// Chat avec Claude (réponse en flux SSE)
function chatSnapshot() {
  const a = currentAnalysis();
  const slim = (s) => ({ match: `${s.home} - ${s.away}`, sport: s.sport, league: s.league, heure: s.time, marche: s.market, selection: s.outcomeLabel, cotes: s.odds, meilleure: `${s.best} (${label(s.bestBook)})`, ecartPct: s.gapPct, coteJuste: s.fairOdd, valuePct: s.valuePct });
  const settled = db.bets.filter((b) => b.status !== 'pending');
  const profit = settled.reduce((acc, b) => acc + (b.status === 'won' ? b.stake * (b.odd - 1) : b.status === 'lost' ? -b.stake : 0), 0);
  return {
    dernierScan: db.lastScan ? { date: db.lastScan.at, sports: db.lastScan.sports, nbMatchs: db.lastScan.matches.length, paysDetecteParFlashscore: db.lastScan.geo } : null,
    reglages: { bankroll: db.settings.bankroll, fractionKelly: db.settings.kellyFraction, seuilAlerteEcartPct: db.settings.alertGapPct },
    plusGrosEcarts: (a?.selections || []).slice(0, 30).map(slim),
    meilleuresValues: (a?.selections || []).filter((s) => s.valuePct != null).sort((x, y) => y.valuePct - x.valuePct).slice(0, 15).map(slim),
    surebets: (a?.surebets || []).slice(0, 10).map((s) => ({ match: `${s.home} - ${s.away}`, marche: s.market, sommeInverses: s.sumInv, profitPct: s.profitPct, jambes: s.legs })),
    margesBooks: a?.margins,
    plusGrosMouvements: (a?.movements || []).slice(0, 15),
    journal: { nbParis: db.bets.length, enCours: db.bets.filter((b) => b.status === 'pending').length, beneficeRegle: Math.round(profit * 100) / 100, derniers: db.bets.slice(-10) },
  };
}

app.post('/api/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-30) : [];
  if (!messages.length) return res.status(400).json({ error: 'message vide' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  try {
    await streamChat({ messages, snapshot: chatSnapshot(), onText: (t) => send({ text: t }), signal: ac.signal });
    send({ done: true });
  } catch (e) {
    if (!ac.signal.aborted) {
      const msg = /api[_ ]?key|auth|credential/i.test(e.message)
        ? "Clé API Anthropic absente ou invalide. Lance l'app avec la variable ANTHROPIC_API_KEY (voir README)."
        : e.message;
      send({ error: msg });
    }
  }
  res.end();
});

const server = app.listen(PORT, () => {
  console.log(`\n  Écarts de cotes prêt sur http://localhost:${PORT}\n`);
});

async function stop() {
  server.close();
  await scraper.shutdown();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
