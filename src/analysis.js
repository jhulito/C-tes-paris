// Transforme les cotes brutes en "sélections" comparables entre books,
// puis calcule écarts, cote juste (consensus sans marge), value, surebets,
// marges des books et mouvements de cotes.
const BOOK_KEYS = ['winamax', 'unibet', 'betclic'];

const MARKET_GROUPS = {
  main: 'Résultat du match (1N2 / Vainqueur)',
  dnb: 'Remboursé si nul',
  dc: 'Double chance',
  btts: 'Les 2 équipes marquent',
  ou: 'Plus / Moins',
  htft: 'Mi-temps / Fin de match',
  cs: 'Score exact',
  period: 'Mi-temps, sets, quart-temps',
};

// Périmètres Flashscore -> libellé ajouté au nom du marché
const SCOPES = {
  FULL_TIME: '',
  FULL_TIME_OVER_TIME: ' (prol. incl.)',
  FIRST_HALF: ' · 1re mi-temps',
  SECOND_HALF: ' · 2e mi-temps',
  FIRST_SET: ' · 1er set',
  SECOND_SET: ' · 2e set',
  THIRD_SET: ' · 3e set',
  FIRST_QUARTER: ' · 1er quart-temps',
  SECOND_QUARTER: ' · 2e quart-temps',
  THIRD_QUARTER: ' · 3e quart-temps',
  FOURTH_QUARTER: ' · 4e quart-temps',
  FIRST_PERIOD: ' · 1re période',
  SECOND_PERIOD: ' · 2e période',
  THIRD_PERIOD: ' · 3e période',
};
const scopeLabel = (scope) => (scope in SCOPES ? SCOPES[scope] : ` · ${String(scope).toLowerCase().replace(/_/g, ' ')}`);
const isMatchScope = (scope) => scope === 'FULL_TIME' || scope === 'FULL_TIME_OVER_TIME';
// Groupes dont on garde l'historique entre scans (les autres sont trop volumineux)
const HISTORY_GROUPS = new Set(['main', 'dnb', 'dc', 'btts', 'ou']);

const isFullTime = (scope) => scope === 'FULL_TIME' || /^FULL_TIME/.test(scope || '');

function participantIds(match) {
  for (const e of match.odds) {
    if (!isFullTime(e.scope)) continue;
    if (e.type === 'HOME_DRAW_AWAY' || e.type === 'HOME_AWAY') {
      const pids = e.items.map((i) => i.pid).filter(Boolean);
      if (pids.length >= 2) return { home: pids[0], away: pids[1] };
    }
  }
  return null;
}

// Convertit une entrée Flashscore en liste de { marketKey, marketLabel, group, complete, outcome, outcomeLabel, value, opening }
function mapEntry(entry, ids, match) {
  const out = [];
  const side = (pid) => (ids && pid === ids.home ? 'home' : ids && pid === ids.away ? 'away' : null);
  const push = (o) => out.push(o);
  for (const it of entry.items) {
    if (!it.active || !(it.value > 1)) continue;
    const base = { value: it.value, opening: it.opening };
    switch (entry.type) {
      case 'HOME_DRAW_AWAY': {
        const s = it.pid ? side(it.pid) : 'draw';
        if (!s) break;
        const map = { home: ['1', match.home], draw: ['N', 'Match nul'], away: ['2', match.away] };
        push({ ...base, group: 'main', complete: true, marketKey: '1X2', marketLabel: '1N2', outcome: map[s][0], outcomeLabel: map[s][1] });
        break;
      }
      case 'HOME_AWAY': {
        const s = side(it.pid);
        if (!s) break;
        push({ ...base, group: 'main', complete: true, marketKey: 'H2H', marketLabel: 'Vainqueur', outcome: s === 'home' ? '1' : '2', outcomeLabel: s === 'home' ? match.home : match.away });
        break;
      }
      case 'DRAW_NO_BET': {
        const s = side(it.pid);
        if (!s) break;
        push({ ...base, group: 'dnb', complete: true, marketKey: 'DNB', marketLabel: 'Remboursé si nul', outcome: s === 'home' ? '1' : '2', outcomeLabel: s === 'home' ? match.home : match.away });
        break;
      }
      case 'DOUBLE_CHANCE': {
        // Flashscore : id domicile = 1N, id extérieur = N2, sans id = 12
        const s = it.pid ? side(it.pid) : 'none';
        const map = { home: ['1N', `${match.home} ou nul`], away: ['N2', `Nul ou ${match.away}`], none: ['12', `${match.home} ou ${match.away}`] };
        if (!map[s]) break;
        push({ ...base, group: 'dc', complete: false, marketKey: 'DC', marketLabel: 'Double chance', outcome: map[s][0], outcomeLabel: map[s][1] });
        break;
      }
      case 'BOTH_TEAMS_TO_SCORE': {
        if (it.btts == null) break;
        push({ ...base, group: 'btts', complete: true, marketKey: 'BTTS', marketLabel: 'Les 2 équipes marquent', outcome: it.btts ? 'Oui' : 'Non', outcomeLabel: it.btts ? 'Oui' : 'Non' });
        break;
      }
      case 'OVER_UNDER': {
        if (it.line == null || !it.selection) break;
        const over = it.selection === 'OVER';
        push({ ...base, group: 'ou', complete: true, marketKey: `OU${it.line}`, marketLabel: `Plus/Moins ${it.line}`, outcome: over ? '+' : '-', outcomeLabel: `${over ? 'Plus' : 'Moins'} de ${it.line}` });
        break;
      }
      case 'HALF_FULL_TIME': {
        // winner = "1/X" : résultat à la mi-temps / résultat final
        if (!/^[12X]\/[12X]$/.test(it.winner || '')) break;
        const name = { 1: match.home, X: 'Nul', 2: match.away };
        const [ht, ft] = it.winner.split('/');
        push({ ...base, group: 'htft', complete: true, marketKey: 'HTFT', marketLabel: 'Mi-temps / Fin', outcome: it.winner, outcomeLabel: `${name[ht]} / ${name[ft]}` });
        break;
      }
      case 'CORRECT_SCORE': {
        // score = "domicile:extérieur"
        if (!/^\d+:\d+$/.test(it.score || '')) break;
        push({ ...base, group: 'cs', complete: false, marketKey: 'CS', marketLabel: 'Score exact', outcome: it.score, outcomeLabel: `Score ${it.score.replace(':', '-')}` });
        break;
      }
      // Les handicaps (asiatique / européen) ne sont pas repris : le sens de la
      // ligne n'est pas assez clair dans les données pour l'afficher sans risque d'erreur.
      default:
        break;
    }
  }
  return out;
}

const pct = (x) => Math.round(x * 10000) / 100; // 0.1234 -> 12.34

/**
 * Construit toutes les analyses à partir du résultat d'un scan.
 */
function analyze(matches) {
  const selections = [];
  const surebets = [];
  const marginAcc = Object.fromEntries(BOOK_KEYS.map((b) => [b, { sum: 0, n: 0 }]));
  const movements = [];

  for (const match of matches) {
    const ids = participantIds(match);
    // markets[marketKey] = { info, outcomes: { outcome: { label, odds:{book:v}, opening:{book:v} } } }
    const markets = {};
    for (const entry of match.odds) {
      // On ne mélange jamais deux périmètres différents (match, mi-temps, set, prolongations incluses…)
      const suffix = entry.scope === 'FULL_TIME' ? '' : '@' + entry.scope;
      const extra = scopeLabel(entry.scope);
      for (const s of mapEntry(entry, ids, match)) {
        const key = s.marketKey + suffix;
        // Tout ce qui ne porte pas sur le match entier va dans le groupe "period"
        const group = isMatchScope(entry.scope) ? s.group : 'period';
        const m = (markets[key] ||= { key, label: s.marketLabel + extra, group, complete: s.complete, outcomes: {} });
        const o = (m.outcomes[s.outcome] ||= { label: s.outcomeLabel, odds: {}, opening: {} });
        o.odds[entry.book] = s.value;
        if (s.opening) o.opening[entry.book] = s.opening;
      }
    }

    for (const m of Object.values(markets)) {
      const outcomeKeys = Object.keys(m.outcomes);
      // Nombre d'issues attendu pour un marché complet
      const expected = m.key.startsWith('1X2') ? 3 : m.key.startsWith('HTFT') ? 9 : 2;
      const isComplete = m.complete && outcomeKeys.length === expected;

      // Probabilités "justes" : on retire la marge de chaque book puis on fait la moyenne.
      const fair = {};
      if (isComplete) {
        const perBook = [];
        for (const b of BOOK_KEYS) {
          if (!outcomeKeys.every((k) => m.outcomes[k].odds[b])) continue;
          const inv = outcomeKeys.map((k) => 1 / m.outcomes[k].odds[b]);
          const sum = inv.reduce((a, c) => a + c, 0);
          if (m.group === 'main') {
            // Marge comparée uniquement sur le résultat du match (même marché pour tous)
            marginAcc[b].sum += sum - 1;
            marginAcc[b].n += 1;
          }
          perBook.push(Object.fromEntries(outcomeKeys.map((k, i) => [k, inv[i] / sum])));
        }
        if (perBook.length) {
          for (const k of outcomeKeys) fair[k] = perBook.reduce((a, p) => a + p[k], 0) / perBook.length;
        }
      }

      // Surebet : meilleure cote de chaque issue, chez n'importe lequel des 3 books
      if (isComplete) {
        const legs = outcomeKeys.map((k) => {
          const o = m.outcomes[k];
          const [book, value] = Object.entries(o.odds).sort((a, b) => b[1] - a[1])[0];
          return { outcome: k, label: o.label, book, value };
        });
        const inv = legs.reduce((a, l) => a + 1 / l.value, 0);
        const books = new Set(legs.map((l) => l.book));
        if (books.size >= 2) {
          surebets.push({
            matchId: match.id, sport: match.sport, home: match.home, away: match.away, league: match.league, time: match.time, url: match.url,
            market: m.label, group: m.group,
            legs: legs.map((l) => ({ ...l, stakePct: pct(1 / l.value / inv) })),
            sumInv: Math.round(inv * 10000) / 10000,
            profitPct: pct(1 / inv - 1),
            isArb: inv < 1,
          });
        }
      }

      for (const k of outcomeKeys) {
        const o = m.outcomes[k];
        const entries = Object.entries(o.odds);
        if (entries.length < 2) continue;
        entries.sort((a, b) => b[1] - a[1]);
        const [bestBook, best] = entries[0];
        const [worstBook, worst] = entries[entries.length - 1];
        const others = entries.slice(1).map((e) => e[1]);
        const othersAvg = others.reduce((a, c) => a + c, 0) / others.length;
        const p = fair[k];
        const sel = {
          key: `${match.id}|${m.key}|${k}`,
          matchId: match.id, sport: match.sport, home: match.home, away: match.away, league: match.league, time: match.time, url: match.url,
          market: m.label, marketKey: m.key, group: m.group, outcome: k, outcomeLabel: o.label,
          odds: o.odds, opening: o.opening,
          best, bestBook, worst, worstBook, nBooks: entries.length,
          gapPct: pct(best / worst - 1),
          bestVsOthersPct: pct(best / othersAvg - 1),
          fairOdd: p ? Math.round((1 / p) * 100) / 100 : null,
          fairProb: p ? pct(p) : null,
          valuePct: p ? pct(best * p - 1) : null,
        };
        selections.push(sel);

        for (const [book, v] of entries) {
          const op = o.opening[book];
          if (op && op > 1 && op !== v) {
            movements.push({
              key: sel.key, book, home: match.home, away: match.away, sport: match.sport, league: match.league, time: match.time, url: match.url,
              market: m.label, outcomeLabel: o.label, opening: op, current: v, changePct: pct(v / op - 1),
            });
          }
        }
      }
    }
  }

  const margins = Object.fromEntries(
    BOOK_KEYS.map((b) => [b, marginAcc[b].n ? { avgMarginPct: pct(marginAcc[b].sum / marginAcc[b].n), trjPct: pct(1 / (1 + marginAcc[b].sum / marginAcc[b].n)), markets: marginAcc[b].n } : null])
  );

  // Fréquence à laquelle chaque book propose la meilleure cote
  const bestCount = Object.fromEntries(BOOK_KEYS.map((b) => [b, 0]));
  for (const s of selections) bestCount[s.bestBook]++;

  selections.sort((a, b) => b.gapPct - a.gapPct);
  surebets.sort((a, b) => a.sumInv - b.sumInv);
  movements.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  return { selections, surebets, movements, margins, bestCount };
}

/** Mise de Kelly (fraction) pour une cote et une probabilité estimée. */
function kelly(odd, prob, fraction = 0.25) {
  const b = odd - 1;
  const f = (b * prob - (1 - prob)) / b;
  return Math.max(0, f * fraction);
}

module.exports = { analyze, kelly, BOOK_KEYS, MARKET_GROUPS, HISTORY_GROUPS };
