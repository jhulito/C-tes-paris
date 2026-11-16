const test = require('node:test');
const assert = require('node:assert');
const { analyze, kelly } = require('../src/analysis');

const H = 'homeId', A = 'awayId';
const x12 = (book, h, a, d, opening) => ({
  book, type: 'HOME_DRAW_AWAY', scope: 'FULL_TIME',
  items: [
    { pid: H, value: h, opening: opening ?? h, active: true },
    { pid: A, value: a, opening: a, active: true },
    { pid: null, value: d, opening: d, active: true },
  ],
});
const match = (odds) => ({ id: 'm1', sport: 'football', home: 'Paris', away: 'Lyon', league: 'FRANCE : Ligue 1', time: '21:00', url: 'u', odds });

test('écart, cote juste et value sur un 1N2 à 3 books', () => {
  const r = analyze([match([x12('winamax', 2.0, 3.8, 3.4), x12('unibet', 2.1, 3.5, 3.3), x12('betclic', 1.9, 3.6, 3.5, 1.7)])]);
  const home = r.selections.find((s) => s.key === 'm1|1X2|1');
  assert.equal(home.best, 2.1);
  assert.equal(home.bestBook, 'unibet');
  assert.equal(home.worstBook, 'betclic');
  assert.equal(home.gapPct, 10.53); // 2.1 / 1.9 - 1
  assert.equal(home.nBooks, 3);
  assert.ok(home.fairOdd > 2.0 && home.fairOdd < 2.2);
  const away = r.selections.find((s) => s.key === 'm1|1X2|2');
  assert.equal(away.outcomeLabel, 'Lyon');
  const draw = r.selections.find((s) => s.key === 'm1|1X2|N');
  assert.equal(draw.outcomeLabel, 'Match nul');
  // mouvement d'ouverture Betclic 1.7 -> 1.9
  assert.ok(r.movements.some((m) => m.book === 'betclic' && m.changePct === 11.76));
  assert.ok(r.margins.winamax.avgMarginPct > 0);
});

test('détection de surebet', () => {
  const r = analyze([match([x12('winamax', 2.6, 3.0, 3.6), x12('unibet', 2.1, 3.9, 3.3), x12('betclic', 2.0, 3.6, 4.0)])]);
  const sb = r.surebets[0];
  // 1/2.6 + 1/3.9 + 1/4.0 = 0.8917
  assert.equal(sb.isArb, true);
  assert.equal(sb.legs.find((l) => l.outcome === '1').book, 'winamax');
  assert.ok(sb.profitPct > 12);
  const total = sb.legs.reduce((a, l) => a + l.stakePct, 0);
  assert.ok(Math.abs(total - 100) < 0.05);
});

test('une sélection présente chez un seul book est ignorée', () => {
  const r = analyze([match([x12('winamax', 2.0, 3.8, 3.4)])]);
  assert.equal(r.selections.length, 0);
});

test('Kelly', () => {
  assert.equal(kelly(2.0, 0.5, 1), 0);
  assert.ok(Math.abs(kelly(2.2, 0.5, 1) - 0.0833) < 0.001);
});

test('mi-temps, score exact et mi-temps/fin de match', () => {
  const half = (book, h, a, d) => ({ ...x12(book, h, a, d), scope: 'FIRST_HALF' });
  const htft = (book, v) => ({ book, type: 'HALF_FULL_TIME', scope: 'FULL_TIME', items: ['1/1', 'X/1', '2/1', '1/X', 'X/X', '2/X', '1/2', 'X/2', '2/2'].map((w, i) => ({ winner: w, value: v[i], active: true })) });
  const cs = (book, v00, v10) => ({ book, type: 'CORRECT_SCORE', scope: 'FULL_TIME', items: [{ score: '0:0', value: v00, active: true }, { score: '1:0', value: v10, active: true }] });
  const r = analyze([match([
    x12('winamax', 2.0, 3.8, 3.4), x12('unibet', 2.1, 3.5, 3.3),
    half('winamax', 2.6, 4.5, 2.1), half('unibet', 2.8, 4.2, 2.0),
    htft('winamax', [3, 5, 20, 14, 5, 14, 30, 9, 8]), htft('unibet', [3.2, 5, 21, 13, 5.2, 14, 28, 9, 7.5]),
    cs('winamax', 9, 7), cs('betclic', 12, 7.5),
  ])]);
  const h = r.selections.find((s) => s.key === 'm1|1X2@FIRST_HALF|1');
  assert.equal(h.group, 'period');
  assert.equal(h.market, '1N2 · 1re mi-temps');
  assert.equal(h.best, 2.8);
  const hf = r.selections.find((s) => s.key === 'm1|HTFT|X/1');
  assert.equal(hf.outcomeLabel, 'Nul / Paris');
  assert.ok(hf.fairOdd); // 9 issues présentes chez 2 books -> cote juste calculée
  const c = r.selections.find((s) => s.key === 'm1|CS|0:0');
  assert.equal(c.outcomeLabel, 'Score 0-0');
  assert.equal(c.bestBook, 'betclic');
  assert.equal(c.fairOdd, null);
  // le 1N2 du match reste dans "main"
  assert.equal(r.selections.find((s) => s.key === 'm1|1X2|1').group, 'main');
});
