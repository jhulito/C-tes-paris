/* Interface de l'application "Écarts de cotes" (JavaScript sans framework). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const BOOKS = ['winamax', 'unibet', 'betclic'];
const BOOK_LABEL = { winamax: 'Winamax', unibet: 'Unibet', betclic: 'Betclic' };
const COLORS = { winamax: '#e11d48', unibet: '#16a34a', betclic: '#f97316' };

const state = { meta: null, analysis: null, bets: [], chat: [], lastAlertT: 0 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '–' : Number(n).toFixed(d));
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('non connecté'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const timeAgo = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `il y a ${h} h` : new Date(iso).toLocaleString('fr-FR');
};
function toast(title, text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<b>${esc(title)}</b>${esc(text)}`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 7000);
}

// ---------- Onglets ----------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  try { localStorage.setItem('tab', b.dataset.tab); } catch {}
  if (b.dataset.tab === 'chat') $('#chatInput').focus();
});

// ---------- Meta / scan ----------
async function loadMeta() {
  state.meta = await api('/api/meta');
  const m = state.meta;
  // filtres
  const sports = Object.entries(m.sports);
  $('#fSport').innerHTML = '<option value="">Tous les sports</option>' + sports.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const groupOpts = Object.entries(m.groups).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#fGroup').innerHTML = '<option value="">Tous les marchés</option>' + groupOpts;
  $('#fGroup').value = 'main';
  $('#vGroup').innerHTML = '<option value="">Tous les marchés</option>' + groupOpts;
  $('#vGroup').value = 'main';
  $('#chatModel').textContent = 'Modèle : ' + m.model;
  renderSettings();
  renderScanInfo();
}

function renderScanInfo() {
  const m = state.meta;
  const s = m.lastScan;
  $('#scanInfo').textContent = s ? `Dernier scan ${timeAgo(s.at)} · ${s.matches} matchs` : 'Aucun scan pour le moment';
  $('#scanBtn').disabled = m.scan.running;
  $('#scanBtn').textContent = m.scan.running ? 'Scan en cours…' : 'Lancer un scan';
}

$('#scanBtn').addEventListener('click', async () => {
  await api('/api/scan', { method: 'POST', body: {} });
  pollScan();
});

let polling = false;
async function pollScan() {
  if (polling) return;
  polling = true;
  const bar = $('#progress');
  bar.classList.remove('hidden');
  $('#scanBtn').disabled = true;
  $('#scanBtn').textContent = 'Scan en cours…';
  try {
    for (;;) {
      const s = await api('/api/scan');
      const p = s.progress || {};
      let txt = 'Démarrage du navigateur…', w = 3;
      if (p.phase === 'list') txt = `Récupération de la liste des matchs (${p.sport})…`, w = 6;
      if (p.phase === 'odds') txt = `Cotes ${p.done}/${p.total} — ${p.match}`, w = 6 + (94 * p.done) / Math.max(1, p.total);
      $('.bar', bar).style.width = w + '%';
      $('.ptext', bar).textContent = txt;
      if (!s.running) {
        if (s.error) toast('Erreur de scan', s.error);
        break;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  } finally {
    polling = false;
    bar.classList.add('hidden');
    await loadMeta();
    await loadAnalysis();
    checkAlerts();
  }
}

// ---------- Analyse ----------
async function loadAnalysis() {
  const a = await api('/api/analysis');
  state.analysis = a.empty ? null : a;
  const warn = $('#geoWarn');
  const errs = state.meta.lastScan?.errors || [];
  if (state.analysis) {
    const present = new Set(state.analysis.selections.flatMap((s) => Object.keys(s.odds)));
    const missing = BOOKS.filter((b) => !present.has(b));
    const msgs = [];
    if (missing.length) msgs.push(`Aucune cote trouvée pour <b>${missing.map((b) => BOOK_LABEL[b]).join(', ')}</b>. Flashscore affiche les books selon le pays de connexion (détecté : <b>${esc(a.geo || '?')}</b>) : lance l'application depuis une connexion française pour avoir les 3 books.`);
    if (errs.length) msgs.push(`${errs.length} match(s) n'ont pas pu être lus (ex. : ${esc(errs[0])}).`);
    warn.innerHTML = msgs.join('<br>');
    warn.classList.toggle('hidden', !msgs.length);
  } else warn.classList.add('hidden');
  renderAll();
}

function renderAll() {
  renderKpis();
  renderGaps();
  renderValue();
  renderSurebets();
  renderMoves();
  renderBooks();
}

function oddsCells(s) {
  return BOOKS.map((b) => {
    const v = s.odds[b];
    if (!v) return `<td class="num ob" data-l="${BOOK_LABEL[b]}"><span class="odd none">–</span></td>`;
    const cls = v === s.best ? 'best' : v === s.worst && s.best !== s.worst ? 'worst' : '';
    const op = s.opening?.[b];
    const title = op && op !== v ? `Ouverture ${op} → ${v}` : '';
    return `<td class="num ob" data-l="${BOOK_LABEL[b]}"><span class="odd ${cls}" title="${title}">${fmt(v)}</span></td>`;
  }).join('');
}
const matchCell = (s) => `<td class="match"><b>${esc(s.home)} – ${esc(s.away)}</b><small>${esc(s.time)} · ${esc(s.league || s.sport)}</small></td>`;
const gapClass = (g) => (g >= 10 ? 'hot' : g >= 5 ? 'warm' : '');

function renderKpis() {
  const a = state.analysis;
  if (!a) return ($('#kpis').innerHTML = '');
  const main = a.selections.filter((s) => s.group === 'main');
  const top = main[0];
  const nMatches = new Set(a.selections.map((s) => s.matchId)).size;
  const arbs = a.surebets.filter((s) => s.isArb).length;
  const values = a.selections.filter((s) => s.valuePct > 0 && s.nBooks === 3).length;
  $('#kpis').innerHTML = [
    ['Matchs avec cotes', nMatches],
    ['Sélections comparées', a.selections.length],
    ['Plus gros écart (1N2)', top ? `${fmt(top.gapPct, 1)} %` : '–'],
    ['Values positives (3 books)', values],
    ['Surebets', arbs],
  ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#sbBadge').textContent = arbs;
  $('#sbBadge').classList.toggle('hidden', !arbs);
}

function filteredGaps() {
  const a = state.analysis;
  if (!a) return [];
  const q = $('#fSearch').value.trim().toLowerCase();
  const sport = $('#fSport').value, group = $('#fGroup').value;
  const minGap = Number($('#fMinGap').value) || 0, three = $('#fThree').checked;
  let rows = a.selections.filter((s) =>
    (!sport || s.sport === sport) && (!group || s.group === group) && s.gapPct >= minGap && (!three || s.nBooks === 3) &&
    (!q || `${s.home} ${s.away} ${s.league}`.toLowerCase().includes(q)));
  const sort = $('#fSort').value;
  if (sort === 'value') rows.sort((x, y) => (y.valuePct ?? -99) - (x.valuePct ?? -99));
  else if (sort === 'outlier') rows.sort((x, y) => y.bestVsOthersPct - x.bestVsOthersPct);
  else if (sort === 'time') rows.sort((x, y) => x.time.localeCompare(y.time));
  return rows.slice(0, 300);
}

function renderGaps() {
  const t = $('#gapTable');
  if (!state.analysis) return (t.innerHTML = `<tr><td class="empty">Lance un premier scan pour voir les écarts de cotes entre Winamax, Unibet et Betclic.</td></tr>`);
  const rows = filteredGaps();
  if (!rows.length) return (t.innerHTML = `<tr><td class="empty">Aucune sélection ne correspond aux filtres.</td></tr>`);
  t.innerHTML = `<thead><tr><th>Match</th><th>Marché</th><th>Sélection</th>${BOOKS.map((b) => `<th class="num">${BOOK_LABEL[b]}</th>`).join('')}<th class="num">Écart</th><th class="num">Cote juste</th><th class="num">Value</th><th class="num">Depuis dernier scan</th><th></th></tr></thead><tbody>` +
    rows.map((s) => `<tr data-key="${esc(s.key)}">${matchCell(s)}<td class="mk"><span class="tag">${esc(s.market)}</span></td><td class="sel">${esc(s.outcomeLabel)}</td>${oddsCells(s)}
      <td class="num gap ${gapClass(s.gapPct)}" data-l="Écart">${fmt(s.gapPct, 1)} %</td>
      <td class="num" data-l="Cote juste">${fmt(s.fairOdd)}</td>
      <td data-l="Value" class="num ${s.valuePct > 0 ? 'pos' : s.valuePct < 0 ? 'neg' : ''}">${s.valuePct == null ? '–' : fmt(s.valuePct, 1) + ' %'}</td>
      <td data-l="Depuis scan" class="num ${s.sinceLastPct > 0 ? 'pos' : s.sinceLastPct < 0 ? 'neg' : ''}">${s.sinceLastPct ? (s.sinceLastPct > 0 ? '+' : '') + fmt(s.sinceLastPct, 1) + ' %' : '–'}</td>
      <td class="acts"><button class="iconbtn" data-act="hist" title="Historique">📈</button> <button class="iconbtn" data-act="bet" title="Ajouter au journal">＋</button> <a class="btn iconbtn" href="${esc(s.url)}" target="_blank" rel="noreferrer" title="Voir sur Flashscore">↗</a></td></tr>`).join('') + '</tbody>';
}

function kellyStake(odd, fairOdd) {
  if (!fairOdd) return 0;
  const p = 1 / fairOdd, b = odd - 1;
  const f = Math.max(0, (b * p - (1 - p)) / b) * Number(state.meta.settings.kellyFraction || 0.25);
  return f * Number(state.meta.settings.bankroll || 0);
}

function renderValue() {
  const t = $('#valueTable');
  const a = state.analysis;
  if (!a) return (t.innerHTML = `<tr><td class="empty">Pas encore de données.</td></tr>`);
  const group = $('#vGroup').value, min = Number($('#vMin').value) || 0, three = $('#vThree').checked;
  const rows = a.selections.filter((s) => s.valuePct != null && s.valuePct >= min && (!group || s.group === group) && (!three || s.nBooks === 3))
    .sort((x, y) => y.valuePct - x.valuePct).slice(0, 200);
  if (!rows.length) return (t.innerHTML = `<tr><td class="empty">Aucune value au-dessus de ${min} % pour le moment.</td></tr>`);
  t.innerHTML = `<thead><tr><th>Match</th><th>Marché</th><th>Sélection</th><th class="num">Meilleure cote</th><th>Book</th><th class="num">Cote juste</th><th class="num">Proba juste</th><th class="num">Value</th><th class="num">Mise Kelly</th><th></th></tr></thead><tbody>` +
    rows.map((s) => `<tr data-key="${esc(s.key)}">${matchCell(s)}<td class="mk"><span class="tag">${esc(s.market)}</span></td><td class="sel">${esc(s.outcomeLabel)}</td>
      <td class="num" data-l="Meilleure"><span class="odd best">${fmt(s.best)}</span></td><td data-l="Book"><span class="bk ${s.bestBook}">${BOOK_LABEL[s.bestBook]}</span></td>
      <td class="num" data-l="Cote juste">${fmt(s.fairOdd)}</td><td class="num" data-l="Proba">${fmt(s.fairProb, 1)} %</td><td class="num pos" data-l="Value">+${fmt(s.valuePct, 1)} %</td>
      <td class="num" data-l="Mise Kelly">${fmt(kellyStake(s.best, s.fairOdd))} €</td>
      <td class="acts"><button class="iconbtn" data-act="bet" title="Ajouter au journal">＋</button></td></tr>`).join('') + '</tbody>';
}

function renderSurebets() {
  const box = $('#sbList');
  const a = state.analysis;
  if (!a) return (box.innerHTML = '<div class="empty">Pas encore de données.</div>');
  const total = Number($('#sbStake').value) || 100;
  const list = a.surebets.filter((s) => ($('#sbOnly').checked ? s.isArb : s.sumInv < 1.03)).slice(0, 60);
  if (!list.length) return (box.innerHTML = '<div class="empty">Aucun surebet ni quasi-surebet (&lt; 3 % de marge combinée) sur le dernier scan.</div>');
  box.innerHTML = list.map((s) => `<div class="card ${s.isArb ? 'arb' : ''}">
    <h3>${esc(s.home)} – ${esc(s.away)}</h3>
    <div class="meta">${esc(s.time)} · ${esc(s.league)} · <span class="tag">${esc(s.market)}</span></div>
    <div class="bigpct ${s.isArb ? 'pos' : 'muted'}">${s.isArb ? '+' + fmt(s.profitPct) + ' % garanti' : 'Marge combinée ' + fmt((s.sumInv - 1) * 100) + ' %'}</div>
    <table class="legs">${s.legs.map((l) => `<tr><td>${esc(l.label)}</td><td><span class="bk ${l.book}">${BOOK_LABEL[l.book]}</span> @ ${fmt(l.value)}</td><td>${fmt((total * l.stakePct) / 100)} €</td></tr>`).join('')}
    <tr><td colspan="2" class="muted">Retour quelle que soit l'issue</td><td>${fmt(total / s.sumInv)} €</td></tr></table></div>`).join('');
}

function renderMoves() {
  const t = $('#moveTable');
  const a = state.analysis;
  if (!a) return (t.innerHTML = `<tr><td class="empty">Pas encore de données.</td></tr>`);
  const book = $('#mBook').value, dir = $('#mDir').value;
  const rows = a.movements.filter((m) => (!book || m.book === book) && (!dir || (dir === 'down' ? m.changePct < 0 : m.changePct > 0))).slice(0, 200);
  if (!rows.length) return (t.innerHTML = `<tr><td class="empty">Aucun mouvement.</td></tr>`);
  t.innerHTML = `<thead><tr><th>Match</th><th>Marché</th><th>Sélection</th><th>Book</th><th class="num">Ouverture</th><th class="num">Actuelle</th><th class="num">Variation</th></tr></thead><tbody>` +
    rows.map((m) => `<tr>${matchCell(m)}<td class="mk"><span class="tag">${esc(m.market)}</span></td><td class="sel">${esc(m.outcomeLabel)}</td><td data-l="Book"><span class="bk ${m.book}">${BOOK_LABEL[m.book]}</span></td>
      <td class="num" data-l="Ouverture">${fmt(m.opening)}</td><td class="num" data-l="Actuelle">${fmt(m.current)}</td><td data-l="Variation" class="num ${m.changePct > 0 ? 'pos' : 'neg'}">${m.changePct > 0 ? '+' : ''}${fmt(m.changePct, 1)} %</td></tr>`).join('') + '</tbody>';
}

function renderBooks() {
  const box = $('#bookCards');
  const a = state.analysis;
  if (!a) return (box.innerHTML = '<div class="empty">Pas encore de données.</div>');
  const totalBest = Object.values(a.bestCount).reduce((x, y) => x + y, 0) || 1;
  box.innerHTML = BOOKS.map((b) => {
    const m = a.margins[b];
    const share = (a.bestCount[b] / totalBest) * 100;
    return `<div class="card"><h3><span class="bk ${b}">${BOOK_LABEL[b]}</span></h3>
      ${m ? `<div class="meta">${m.markets} marchés complets analysés</div>
      <div>Marge moyenne : <b>${fmt(m.avgMarginPct)} %</b></div><div>TRJ moyen : <b>${fmt(m.trjPct)} %</b></div>` : '<div class="meta">Aucune cote relevée pour ce book.</div>'}
      <div style="margin-top:10px">Meilleure cote sur <b>${fmt(share, 1)} %</b> des sélections</div>
      <div class="meter"><div style="width:${share}%;background:${COLORS[b]}"></div></div></div>`;
  }).join('');
}

// Re-rendu sur changement de filtre
['#fSearch', '#fSport', '#fGroup', '#fMinGap', '#fThree', '#fSort'].forEach((s) => $(s).addEventListener('input', renderGaps));
['#vGroup', '#vMin', '#vThree'].forEach((s) => $(s).addEventListener('input', renderValue));
['#sbStake', '#sbOnly'].forEach((s) => $(s).addEventListener('input', renderSurebets));
['#mBook', '#mDir'].forEach((s) => $(s).addEventListener('input', renderMoves));

// Actions sur les lignes (historique / ajout au journal)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const key = btn.closest('tr')?.dataset.key;
  const s = state.analysis?.selections.find((x) => x.key === key);
  if (!s) return;
  if (btn.dataset.act === 'hist') showHistory(s);
  if (btn.dataset.act === 'bet') {
    const f = $('#betForm');
    f.event.value = `${s.home} - ${s.away}`;
    f.selection.value = `${s.market} : ${s.outcomeLabel}`;
    f.book.value = BOOK_LABEL[s.bestBook];
    f.odd.value = s.best;
    f.fairOdd.value = s.fairOdd ?? '';
    f.stake.value = s.fairOdd ? Math.max(0, Math.round(kellyStake(s.best, s.fairOdd) * 100) / 100) || '' : '';
    f.dataset.key = s.key;
    $('#tabs [data-tab="journal"]').click();
    f.stake.focus();
  }
});

async function showHistory(s) {
  const h = await api('/api/history?key=' + encodeURIComponent(s.key));
  const pts = h.map((x) => ({ t: x.t, ...x.o }));
  // ajoute les cotes d'ouverture comme premier point si disponibles
  let body = `<h3>${esc(s.home)} – ${esc(s.away)}</h3><div class="muted">${esc(s.market)} · ${esc(s.outcomeLabel)}</div>`;
  const opening = BOOKS.filter((b) => s.opening?.[b]).map((b) => `${BOOK_LABEL[b]} ${fmt(s.opening[b])}`).join(' · ');
  if (opening) body += `<p class="muted">Cotes d'ouverture : ${opening}</p>`;
  if (pts.length < 2) body += `<p>Un seul relevé pour l'instant. Relance des scans (ou active le scan automatique) pour suivre l'évolution.</p>`;
  else {
    const W = 640, H = 220, P = 30;
    const vals = pts.flatMap((p) => BOOKS.map((b) => p[b]).filter(Boolean));
    const min = Math.min(...vals) * 0.98, max = Math.max(...vals) * 1.02;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const X = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const Y = (v) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
    const lines = BOOKS.map((b) => {
      const p = pts.filter((x) => x[b]);
      if (!p.length) return '';
      return `<polyline fill="none" stroke="${COLORS[b]}" stroke-width="2.5" points="${p.map((x) => `${X(x.t)},${Y(x[b])}`).join(' ')}"/>` +
        p.map((x) => `<circle cx="${X(x.t)}" cy="${Y(x[b])}" r="3" fill="${COLORS[b]}"><title>${BOOK_LABEL[b]} ${x[b]} — ${new Date(x.t).toLocaleString('fr-FR')}</title></circle>`).join('');
    }).join('');
    body += `<svg viewBox="0 0 ${W} ${H}" width="100%" style="margin-top:10px">
      <text x="4" y="${Y(max) + 4}" font-size="11" fill="currentColor" opacity=".6">${fmt(max)}</text>
      <text x="4" y="${Y(min) + 4}" font-size="11" fill="currentColor" opacity=".6">${fmt(min)}</text>
      <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="currentColor" opacity=".2"/>${lines}</svg>
      <div class="legend">${BOOKS.map((b) => `<span><i style="background:${COLORS[b]}"></i>${BOOK_LABEL[b]}</span>`).join('')}</div>`;
  }
  $('#modalBody').innerHTML = body;
  $('#modal').classList.remove('hidden');
}
$('#modalClose').onclick = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', (e) => e.target.id === 'modal' && $('#modal').classList.add('hidden'));

// ---------- Journal ----------
async function loadBets() {
  state.bets = await api('/api/bets');
  renderBets();
}
function renderBets() {
  const bets = state.bets;
  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const staked = settled.reduce((a, b) => a + b.stake, 0);
  const profit = settled.reduce((a, b) => a + (b.status === 'won' ? b.stake * (b.odd - 1) : -b.stake), 0);
  const clv = bets.filter((b) => b.closingOdd).map((b) => b.odd / b.closingOdd - 1);
  const won = settled.filter((b) => b.status === 'won').length;
  $('#jKpis').innerHTML = [
    ['Paris', bets.length],
    ['En cours', bets.filter((b) => b.status === 'pending').length],
    ['Bénéfice', `${profit >= 0 ? '+' : ''}${fmt(profit)} €`],
    ['ROI', staked ? `${fmt((profit / staked) * 100, 1)} %` : '–'],
    ['Réussite', settled.length ? `${fmt((won / settled.length) * 100, 0)} %` : '–'],
    ['CLV moyen', clv.length ? `${fmt((clv.reduce((a, c) => a + c, 0) / clv.length) * 100, 1)} %` : '–'],
  ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const t = $('#betTable');
  if (!bets.length) return (t.innerHTML = `<tr><td class="empty">Aucun pari enregistré. Utilise le bouton ＋ dans les onglets Écarts / Value pour pré-remplir.</td></tr>`);
  t.innerHTML = `<thead><tr><th>Date</th><th>Match</th><th>Sélection</th><th>Book</th><th class="num">Cote</th><th class="num">Cote juste</th><th class="num">Mise</th><th>Statut</th><th class="num">Cote clôture</th><th class="num">CLV</th><th class="num">Résultat</th><th></th></tr></thead><tbody>` +
    [...bets].reverse().map((b) => {
      const res = b.status === 'won' ? b.stake * (b.odd - 1) : b.status === 'lost' ? -b.stake : 0;
      const clv = b.closingOdd ? (b.odd / b.closingOdd - 1) * 100 : null;
      return `<tr data-id="${b.id}"><td>${new Date(b.createdAt).toLocaleDateString('fr-FR')}</td><td>${esc(b.event)}</td><td>${esc(b.selection)}</td><td>${esc(b.book)}</td>
      <td class="num">${fmt(b.odd)}</td><td class="num">${fmt(b.fairOdd)}</td><td class="num">${fmt(b.stake)} €</td>
      <td><select data-f="status">${[['pending', 'En cours'], ['won', 'Gagné'], ['lost', 'Perdu'], ['void', 'Remboursé']].map(([v, l]) => `<option value="${v}" ${b.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="num"><input data-f="closingOdd" type="number" step="0.01" value="${b.closingOdd ?? ''}" /></td>
      <td class="num ${clv > 0 ? 'pos' : clv < 0 ? 'neg' : ''}">${clv == null ? '–' : fmt(clv, 1) + ' %'}</td>
      <td class="num ${res > 0 ? 'pos' : res < 0 ? 'neg' : ''}">${b.status === 'pending' ? '–' : (res > 0 ? '+' : '') + fmt(res) + ' €'}</td>
      <td><button class="iconbtn" data-del>🗑</button></td></tr>`;
    }).join('') + '</tbody>';
}
$('#betForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = Object.fromEntries(new FormData(f));
  body.key = f.dataset.key || null;
  await api('/api/bets', { method: 'POST', body });
  f.reset();
  delete f.dataset.key;
  loadBets();
});
$('#betTable').addEventListener('change', async (e) => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const id = el.closest('tr').dataset.id;
  const v = el.dataset.f === 'closingOdd' ? (el.value ? Number(el.value) : null) : el.value;
  await api('/api/bets/' + id, { method: 'PATCH', body: { [el.dataset.f]: v } });
  loadBets();
});
$('#betTable').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-del]')) return;
  if (!confirm('Supprimer ce pari ?')) return;
  await api('/api/bets/' + e.target.closest('tr').dataset.id, { method: 'DELETE' });
  loadBets();
});

// ---------- Chat ----------
function md(src) {
  // Mini-rendu Markdown : titres, gras, italique, code, listes, tableaux, liens.
  const lines = esc(src).split('\n');
  let html = '', list = null, table = [];
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>').replace(/_([^_]+)_/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim())));
    html += '<table>' + rows.map((r, i) => '<tr>' + r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('') + '</tr>').join('') + '</table>';
    table = [];
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(l)) { flushList(); table.push(l.trim()); continue; }
    flushTable();
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^#{1,4}\s+(.*)/))) { flushList(); html += `<p><b>${inline(m[1])}</b></p>`; }
    else if (!l.trim()) flushList();
    else { flushList(); html += `<p>${inline(l)}</p>`; }
  }
  flushList(); flushTable();
  return html;
}

function addMsg(role, content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const b = document.createElement('div');
  b.className = 'bubble';
  if (role === 'user') b.textContent = content; else b.innerHTML = md(content);
  wrap.append(b);
  $('#chatLog').append(wrap);
  $('#chatLog').scrollTop = 1e9;
  return b;
}

function saveChat() { try { localStorage.setItem('chat', JSON.stringify(state.chat.slice(-40))); } catch {} }
function restoreChat() {
  try { state.chat = JSON.parse(localStorage.getItem('chat') || '[]'); } catch { state.chat = []; }
  for (const m of state.chat) addMsg(m.role, m.content);
}

let chatBusy = false;
async function sendChat(text) {
  if (chatBusy || !text.trim()) return;
  chatBusy = true;
  $('#chatSend').disabled = true;
  state.chat.push({ role: 'user', content: text });
  addMsg('user', text);
  const bubble = addMsg('assistant', '');
  bubble.classList.add('typing');
  let acc = '';
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: state.chat }) });
    if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur réseau');
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!chunk.startsWith('data: ')) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.text) { acc += ev.text; bubble.innerHTML = md(acc); $('#chatLog').scrollTop = 1e9; }
        if (ev.error) throw new Error(ev.error);
      }
    }
    state.chat.push({ role: 'assistant', content: acc || '(réponse vide)' });
  } catch (e) {
    bubble.innerHTML = `<span class="neg">⚠ ${esc(e.message)}</span>`;
    state.chat.pop(); // on retire la question pour pouvoir la renvoyer
  } finally {
    bubble.classList.remove('typing');
    chatBusy = false;
    $('#chatSend').disabled = false;
    saveChat();
  }
}
$('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#chatInput').value; $('#chatInput').value = ''; sendChat(v); });
$('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
$('#chatSuggest').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) sendChat(b.textContent); });
$('#chatClear').addEventListener('click', (e) => { e.preventDefault(); state.chat = []; saveChat(); $$('#chatLog .msg').slice(1).forEach((m) => m.remove()); });

// ---------- Réglages ----------
function renderQuickSports() {
  const { settings, sports } = state.meta;
  $('#qSports').innerHTML = Object.entries(sports).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${settings.sports.includes(k) ? 'checked' : ''}/> ${v}</label>`).join('');
}
$('#qSports').addEventListener('change', async () => {
  let sports = $$('#qSports input:checked').map((x) => x.value);
  if (!sports.length) { sports = ['football']; toast('Sports', 'Il faut au moins un sport : football conservé.'); }
  state.meta.settings = await api('/api/settings', { method: 'PUT', body: { sports } });
  renderSettings();
});

$('#restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Restauration', "Ce fichier n'est pas une sauvegarde valide."); }
  if (!confirm(`Remplacer les données actuelles par cette sauvegarde (${(data.bets || []).length} paris) ?`)) return;
  try {
    const r = await api('/api/restore', { method: 'POST', body: data });
    toast('Restauration', `Sauvegarde restaurée : ${r.bets} paris.`);
    await loadMeta();
    await Promise.all([loadAnalysis(), loadBets()]);
  } catch (err) { toast('Restauration', err.message); }
});

function renderSettings() {
  renderQuickSports();
  const { settings, sports, groups } = state.meta;
  const f = $('#settingsForm');
  $('#sSports').innerHTML = Object.entries(sports).map(([k, v]) => `<label><input type="checkbox" name="sports" value="${k}" ${settings.sports.includes(k) ? 'checked' : ''}/> ${v}</label>`).join('');
  $('#sGroups').innerHTML = Object.entries(groups).map(([k, v]) => `<label><input type="checkbox" name="alertGroups" value="${k}" ${settings.alertGroups.includes(k) ? 'checked' : ''}/> ${v}</label>`).join('');
  for (const k of ['dayOffset', 'maxMatches', 'concurrency', 'autoScanMinutes', 'alertGapPct', 'bankroll', 'kellyFraction']) if (f[k]) f[k].value = settings[k];
}
$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    sports: $$('input[name=sports]:checked', f).map((x) => x.value),
    alertGroups: $$('input[name=alertGroups]:checked', f).map((x) => x.value),
  };
  for (const k of ['dayOffset', 'maxMatches', 'concurrency', 'autoScanMinutes', 'alertGapPct', 'bankroll', 'kellyFraction']) body[k] = Number(f[k].value);
  if (!body.sports.length) body.sports = ['football'];
  state.meta.settings = await api('/api/settings', { method: 'PUT', body });
  $('#settingsSaved').textContent = 'Enregistré ✓';
  setTimeout(() => ($('#settingsSaved').textContent = ''), 2000);
  renderValue();
});
$('#notifBtn').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Notifications', 'Non supportées par ce navigateur.');
  const p = await Notification.requestPermission();
  toast('Notifications', p === 'granted' ? 'Activées : tu seras prévenu des gros écarts et des surebets.' : 'Refusées.');
});

// ---------- Alertes ----------
async function checkAlerts() {
  const first = !state.lastAlertT;
  if (first) { try { state.lastAlertT = Number(localStorage.getItem('lastAlertT')) || Date.now() - 1; } catch { state.lastAlertT = Date.now() - 1; } }
  const alerts = await api('/api/alerts?since=' + state.lastAlertT).catch(() => []);
  if (!alerts.length) return;
  state.lastAlertT = Math.max(...alerts.map((a) => a.t));
  try { localStorage.setItem('lastAlertT', state.lastAlertT); } catch {}
  const shown = alerts.slice(-5);
  for (const a of shown) {
    toast(a.title, a.text);
    if ('Notification' in window && Notification.permission === 'granted') new Notification(a.title, { body: a.text });
  }
  if (alerts.length > shown.length) toast('Alertes', `+${alerts.length - shown.length} autres alertes au-dessus de ton seuil.`);
}

// Rafraîchissement périodique (scan auto côté serveur)
setInterval(async () => {
  const prev = state.meta?.lastScan?.at;
  const s = await api('/api/scan').catch(() => null);
  if (s?.running) return pollScan();
  await loadMeta().catch(() => {});
  if (state.meta?.lastScan?.at !== prev) { await loadAnalysis(); checkAlerts(); }
  else renderScanInfo();
}, 30000);

// ---------- Application installable (écran d'accueil) ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- Démarrage ----------
(async () => {
  try { const t = localStorage.getItem('tab'); if (t) $(`#tabs [data-tab="${t}"]`)?.click(); } catch {}
  restoreChat();
  await loadMeta();
  await Promise.all([loadAnalysis(), loadBets()]);
  if (state.meta.scan.running) pollScan();
})();
