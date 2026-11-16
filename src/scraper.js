// Récupère les cotes affichées publiquement sur Flashscore.fr à l'aide d'un
// vrai navigateur (Playwright). On ouvre les pages comme un visiteur normal
// et on lit les cotes que la page de comparaison charge elle-même.
const { chromium } = require('playwright');

const BASE = 'https://www.flashscore.fr';

// Sports proposés : slug Flashscore -> libellé
const SPORTS = {
  football: 'Football',
  tennis: 'Tennis',
  basket: 'Basket',
  hockey: 'Hockey',
  rugby: 'Rugby',
  handball: 'Handball',
  volleyball: 'Volley',
};

// Les 3 books suivis. Les identifiants sont ceux utilisés par Flashscore ;
// on reconnaît aussi le nom au cas où un identifiant changerait.
const BOOKS = {
  winamax: { label: 'Winamax', ids: [264], re: /winamax/i },
  unibet: { label: 'Unibet', ids: [160], re: /unibet/i },
  betclic: { label: 'Betclic', ids: [141], re: /betclic/i },
};

function bookKeyFor(id, name) {
  for (const [key, b] of Object.entries(BOOKS)) {
    if (b.ids.includes(Number(id)) || (name && b.re.test(name))) return key;
  }
  return null;
}

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const opts = { headless: true };
    if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY };
    if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
    browserPromise = chromium.launch(opts).catch((err) => {
      browserPromise = null;
      throw new Error(
        "Impossible de lancer Chromium. Lance `npx playwright install chromium` puis réessaie. (" + err.message + ')'
      );
    });
  }
  return browserPromise;
}

async function newContext() {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1366, height: 900 },
  });
  // Pas besoin d'images / polices / pubs : plus rapide et plus léger.
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'font' || t === 'media') return route.abort();
    return route.continue();
  });
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Liste les matchs à venir d'un sport pour un jour donné.
 * dayOffset : 0 = aujourd'hui, 1 = demain, etc.
 */
async function listMatches(ctx, sport, dayOffset = 0) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/${sport}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('.event__match', { timeout: 30000 });
    for (let i = 0; i < dayOffset; i++) {
      const next = await page.$('[data-day-picker-arrow="next"]');
      if (!next) break;
      const before = await page.$eval('.event__match', (e) => e.id).catch(() => '');
      await next.click();
      await page
        .waitForFunction((id) => {
          const f = document.querySelector('.event__match');
          return f && f.id !== id;
        }, before, { timeout: 15000 })
        .catch(() => {});
      await sleep(1500);
    }
    return await page.evaluate(() => {
      const out = [];
      let league = '';
      const rows = document.querySelectorAll('.event__match, .headerLeague__wrapper, .event__header');
      for (const el of rows) {
        if (!el.classList.contains('event__match')) {
          const t = el.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
          const country = (t.find((s) => /:$/.test(s)) || '').replace(/:$/, '');
          const name = t.find((s) => !/:$/.test(s) && !/^(Classement|Tableau|Afficher|Voir|Résultats)/i.test(s)) || '';
          league = [country, name].filter(Boolean).join(' : ');
          continue;
        }
        if (!el.classList.contains('event__match--scheduled')) continue; // seulement pré-match
        const link = el.querySelector('a.eventRowLink');
        if (!link) continue;
        const id = el.id.replace(/^g_\d+_/, '');
        const name = link.getAttribute('aria-label') || '';
        const [home, away] = name.split(' - ');
        out.push({
          id,
          url: link.href,
          home: (home || '').trim(),
          away: (away || '').trim(),
          time: (el.querySelector('.event__time')?.textContent || '').trim(),
          league,
        });
      }
      return out;
    });
  } finally {
    await page.close();
  }
}

/**
 * Ouvre la page "Cotes" d'un match et récupère les cotes que la page charge.
 */
async function fetchMatchOdds(ctx, match) {
  const page = await ctx.newPage();
  try {
    const u = new URL(match.url);
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.pathname += 'cotes/';
    const waitOdds = page.waitForResponse(
      (r) => r.url().includes('/odds/pq_graphql') && r.url().includes(match.id) && r.status() === 200,
      { timeout: 15000 }
    );
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const resp = await waitOdds;
    const json = await resp.json();
    const data = json?.data?.findOddsByEventId;
    if (!data) return null;
    const geo = new URL(resp.url()).searchParams.get('geoIpCode');
    const names = {};
    for (const b of data.settings?.bookmakers || []) names[b.bookmaker.id] = b.bookmaker.name;
    const odds = [];
    const seenBooks = new Set();
    for (const entry of data.odds || []) {
      const book = bookKeyFor(entry.bookmakerId, names[entry.bookmakerId]);
      if (!book) continue;
      seenBooks.add(book);
      odds.push({
        book,
        type: entry.bettingType,
        scope: entry.bettingScope,
        items: (entry.odds || []).map((o) => ({
          pid: o.eventParticipantId,
          value: parseFloat(o.value),
          opening: o.opening != null ? parseFloat(o.opening) : null,
          active: o.active !== false,
          line: o.handicap?.value ?? null,
          selection: o.selection ?? null,
          btts: o.bothTeamsToScore ?? null,
        })),
      });
    }
    return { geo, books: [...seenBooks], odds };
  } finally {
    await page.close();
  }
}

/**
 * Scan complet : liste des matchs puis cotes de chacun, avec un nombre
 * limité de pages en parallèle pour rester raisonnable avec le site.
 */
async function scan({ sports = ['football'], dayOffset = 0, maxMatches = 40, concurrency = 3, onProgress = () => {} }) {
  const ctx = await newContext();
  const results = [];
  const errors = [];
  let geo = null;
  try {
    let all = [];
    for (const sport of sports) {
      onProgress({ phase: 'list', sport });
      try {
        const list = await listMatches(ctx, sport, dayOffset);
        all.push(...list.slice(0, maxMatches).map((m) => ({ ...m, sport })));
      } catch (e) {
        errors.push(`${SPORTS[sport] || sport} : liste indisponible (${e.message})`);
      }
    }
    let done = 0;
    const queue = [...all];
    const worker = async () => {
      while (queue.length) {
        const m = queue.shift();
        try {
          const r = await fetchMatchOdds(ctx, m);
          if (r) {
            geo = geo || r.geo;
            if (r.odds.length) results.push({ ...m, books: r.books, odds: r.odds });
          }
        } catch (e) {
          const msg = /Timeout/i.test(e.message) ? 'pas de cotes publiées' : e.message.split('\n')[0];
          errors.push(`${m.home} - ${m.away} : ${msg}`);
        }
        done++;
        onProgress({ phase: 'odds', done, total: all.length, match: `${m.home} - ${m.away}` });
        await sleep(400 + Math.random() * 600);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  } finally {
    await ctx.close();
  }
  return { matches: results, errors, geo };
}

async function shutdown() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close();
  }
}

module.exports = { scan, shutdown, SPORTS, BOOKS };
