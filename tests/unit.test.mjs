// Offline checks of parsing/validation logic. Live behaviour is covered by
// scripts/browser-check.mjs, which loads the real site in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseHeroList, normaliseStats, statsFor, normaliseHeroDetail, rankValue, ApiError } from '../js/data.js';
import { parsePatchNotes, parseNewsList, parseDate } from '../lib/news-parse.mjs';
import { sniff, dimensions } from '../lib/images.mjs';

test('hero list validation', () => {
  assert.throws(() => normaliseHeroList({}), ApiError);
  const list = Array.from({ length: 12 }, (_, i) => ({ key: 'h' + i, name: 'H' + i, role: 'support', gamemodes: ['quickplay', 'stadium'] }));
  assert.equal(normaliseHeroList([...list, { key: 'x', name: 'X', role: 'wizard' }]).length, 12);
});
test('stats rows keep numeric pick + win; ban optional', () => {
  const r = normaliseStats([{ hero: 'ana', pickrate: '12.5', winrate: 51 }, { hero: 'x', pickrate: null, winrate: 50 }]);
  assert.equal(r.length, 1); assert.equal(r[0].banrate, null);
});
test('Open Queue never returns Role Queue data, and bad filters are rejected', async () => {
  const r = await statsFor({ queue: 'open' });
  assert.equal(r.available, false); assert.equal(r.rows, undefined);
  await assert.rejects(statsFor({ queue: 'competitive', division: 'champion' }), ApiError);
  await assert.rejects(statsFor({ queue: '6v6' }), ApiError);
  await assert.rejects(statsFor({ queue: 'quickplay', division: 'gold' }), ApiError);
});
test('hero detail picks up Stadium powers', () => {
  const d = normaliseHeroDetail('tracer', { name: 'Tracer', abilities: [{ name: 'Blink' }], stadium_powers: [{ name: 'P', description: 'd' }] });
  assert.equal(d.stadium.powers[0].name, 'P');
});
test('rank values', () => {
  assert.equal(rankValue({ division: 'bronze', tier: 5 }), 1);
  assert.equal(rankValue({ division: 'master', tier: 4 }), 32);
  assert.equal(rankValue({ division: 'champion', tier: 1 }), 45);
});
test('news parsing', () => {
  const p = parsePatchNotes('<div id="patch-2026-11-05"><h3>Overwatch Retail Patch Notes – November 5, 2026</h3><h4>Hero Updates</h4></div>');
  assert.equal(p[0].date, '2026-11-05');
  const n = parseNewsList('<a href="/news/24316733/directors-take/"><blz-timestamp timestamp="2026-11-10T00:00:00Z"></blz-timestamp><h3>Director’s Take: 5v5</h3></a>', 'https://overwatch.blizzard.com/en-us/news/');
  assert.equal(n[0].date, '2026-11-10');
  assert.equal(parseDate('March 3, 2026'), '2026-03-03');
});
test('image signature + size reading', () => {
  const png = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(360, 20);
  assert.deepEqual(dimensions(png), { width: 640, height: 360 });
  assert.equal(sniff(Buffer.from('<html>no</html>')), null);
});

// ---------- security & tier list (v2.1) ----------
import fs from 'node:fs';
import crypto from 'node:crypto';
import { relay, cssUrl, safeLink } from '../js/safe.js';
import { computeTiers, groupTiers } from '../js/tiers.js';

test('upstream image URLs: https + known hosts only, and safe inside CSS', () => {
  assert.equal(relay('javascript:alert(1)'), '');
  assert.equal(relay('http://d15f34w2p8l1cc.cloudfront.net/a.png'), '');
  assert.equal(relay('https://evil.example/a.png'), '');
  assert.equal(relay('https://user:pw@d15f34w2p8l1cc.cloudfront.net/a.png'), '');
  assert.ok(relay('https://d15f34w2p8l1cc.cloudfront.net/overwatch/a.png'));
  const css = cssUrl("https://d15f34w2p8l1cc.cloudfront.net/a.png');}body{background:red;/*");
  assert.ok(!/['"()][^)]*\)/.test(css.slice(5, -2)), 'no quote or bracket can escape url("…")');
  assert.equal(cssUrl('https://evil.example/x.png'), '');
});
test('news links only go to Blizzard over https', () => {
  assert.equal(safeLink('javascript:alert(1)'), 'https://overwatch.blizzard.com/en-us/news/');
  assert.equal(safeLink('https://blizzard.com.evil.example/x'), 'https://overwatch.blizzard.com/en-us/news/');
  assert.equal(safeLink('https://news.blizzard.com/en-us/article/1'), 'https://news.blizzard.com/en-us/article/1');
});
test('security policy allows the inline head script (hash matches) and nothing else inline', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(inline.length, 1);
  const hash = crypto.createHash('sha256').update(inline[0]).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`), 'CSP hash must match the inline script — update it if the script changes');
  assert.ok(!/unsafe-eval/.test(csp) && /object-src 'none'/.test(csp) && /connect-src 'self' https:\/\/overfast-api\.tekrop\.fr;/.test(csp));
  assert.ok(!/ on[a-z]+="/i.test(html), 'no inline event handlers');
});
test('tier list: every hero gets exactly one tier, best first, roles compared fairly', () => {
  const roles = { a: 'tank', b: 'tank', c: 'damage', d: 'damage', e: 'damage', f: 'support', g: 'support', h: 'support', i: 'damage', j: 'support' };
  const rows = [['a', 10, 55], ['b', 5, 47], ['c', 20, 53], ['d', 8, 50], ['e', 3, 44], ['f', 25, 51], ['g', 6, 49], ['h', 12, 52], ['i', 9, 48], ['j', 2, 50]].map(([hero, pickrate, winrate]) => ({ hero, pickrate, winrate }));
  const t = computeTiers(rows, k => roles[k]);
  assert.equal(t.length, 10);
  assert.ok(t.every(r => ['S', 'A', 'B', 'C', 'D'].includes(r.tier)));
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].score >= t[i].score);
  assert.equal(groupTiers(t).reduce((n, g) => n + g.heroes.length, 0), 10);
  assert.equal(t[0].hero, 'a'); assert.equal(t.at(-1).hero, 'e');
  assert.equal(computeTiers([{ hero: 'zz', pickrate: 5, winrate: 50 }], () => undefined).length, 0, 'unknown role is skipped, not guessed');
});

test('BattleTag spelling: typed form first, common capitalisations covered, bounded', async () => {
  const { tagVariants } = await import('../js/data.js');
  const v = tagVariants('ogkenobi-1697');
  assert.equal(v[0], 'ogkenobi-1697');
  for (const want of ['Ogkenobi-1697', 'OGKENOBI-1697', 'OgKenobi-1697']) assert.ok(v.includes(want), want);
  assert.ok(v.length <= 24);
  assert.deepEqual(tagVariants('NoTag'), ['NoTag']);
});

test('head to head: even band, lower-is-better, minimum games and weighted verdict', async () => {
  const { lead, compareMetrics, careerMetrics, writeSummary } = await import('../js/h2h.js');
  const perTen = { key: 'eliminations_avg_per_10_min', pct: false, lower: false };
  assert.equal(lead(perTen, 20, 19.2), 'even');            // 4% gap
  assert.equal(lead(perTen, 20, 18.9), 'a');               // 5.5% gap
  assert.equal(lead({ key: 'deaths_avg_per_10_min', pct: false, lower: true }, 6, 8), 'a'); // fewer deaths wins
  assert.equal(lead({ key: 'sleep_dart_accuracy', pct: true, lower: false }, 40, 38.5), 'even'); // under 2 points
  const career = (games, win, deaths, darts, acc) => [
    { key: 'game', stats: [{ key: 'games_played', value: games }, { key: 'win_percentage', value: win }] },
    { key: 'average', stats: [{ key: 'deaths_avg_per_10_min', value: deaths }, { key: 'eliminations_avg_per_10_min', value: 10 }] },
    { key: 'hero_specific', stats: [{ key: 'enemies_slept_avg_per_10_min', value: darts }, { key: 'sleep_dart_accuracy', value: acc }, { key: 'enemies_slept_most_in_game', value: 9 }] },
  ];
  const a = careerMetrics(career(30, 55, 5, 3, 45)), b = careerMetrics(career(30, 50, 7, 2, 35));
  assert.ok(!('enemies_slept_most_in_game' in a), 'records are not compared');
  const res = compareMetrics(a, b);
  assert.equal(res.winner, 'a');
  assert.equal(res.scoreA, 8); // win x2 + deaths x2 + darts x2 + accuracy x2
  assert.match(writeSummary(res, 'Iso', 'Kenobi', 'Ana'), /^Iso performs better on Ana/);
  const few = compareMetrics(careerMetrics(career(3, 55, 5, 3, 45)), b);
  assert.equal(few.winner, '');
  assert.match(writeSummary(few, 'Iso', 'Kenobi', 'Ana'), /No call on Ana/);
  // only a single-weight stat differs (eliminations 10 vs 11): 0-1 is within 1 point -> too close to call
  const x = careerMetrics(career(30, 50, 7, 3, 35)), y = careerMetrics(career(30, 50, 7, 3, 35));
  y.eliminations_avg_per_10_min.value = 11;
  const close = compareMetrics(x, y);
  assert.equal(close.winner, 'close');
  assert.match(writeSummary(close, 'Iso', 'Kenobi', 'Ana'), /^Too close to call on Ana/);
});

test('head to head: role focus, off-role stats, records, fingerprint, scoreboard, duo fit', async () => {
  const { careerMetrics, records, fingerprint, scoreboard, duoFit, bestHero, summaryParts, compareMetrics } = await import('../js/h2h.js');
  const groups = (heal, fb) => [
    { key: 'game', stats: [{ key: 'games_played', value: 20 }, { key: 'win_percentage', value: 50 }] },
    { key: 'average', stats: [{ key: 'healing_done_avg_per_10_min', value: heal }, { key: 'final_blows_avg_per_10_min', value: fb }, { key: 'deaths_avg_per_10_min', value: 6 }] },
    { key: 'best', stats: [{ key: 'eliminations_most_in_game', value: 30 }, { key: 'kill_streak_best', value: 12 }] },
    { key: 'hero_specific', stats: [{ key: 'enemies_slept_most_in_game', value: 9 }, { key: 'enemies_slept', value: 400 }] },
  ];
  const dps = careerMetrics(groups(500, 8), 'damage');
  assert.ok(!dps.healing_done_avg_per_10_min, 'healing is not judged for damage heroes');
  assert.equal(dps.final_blows_avg_per_10_min.group, 'focus');
  const sup = careerMetrics(groups(5000, 3), 'support');
  assert.equal(sup.healing_done_avg_per_10_min.group, 'focus');
  const rec = records(groups(1, 1));
  assert.equal(rec.eliminations_most_in_game.label, 'Most eliminations in a game');
  assert.equal(rec.kill_streak_best.label, 'Best kill streak');
  assert.ok(rec.enemies_slept_most_in_game && !rec.enemies_slept, 'only records, not totals');
  const fp = fingerprint(sup, careerMetrics(groups(2500, 6), 'support'));
  const healAxis = fp.find(x => x.label === 'Healing');
  assert.deepEqual([healAxis.a, healAxis.b], [1, 0.5]);
  const heroesA = [{ hero: 'ana', gamesPlayed: 20, winrate: 55 }, { hero: 'mercy', gamesPlayed: 3, winrate: 60 }];
  const heroesB = [{ hero: 'ana', gamesPlayed: 20, winrate: 40 }, { hero: 'mercy', gamesPlayed: 30, winrate: 50 }];
  const sb = scoreboard(heroesA, heroesB, { ana: groups(5000, 3) }, { ana: groups(5000, 3) }, () => 'support');
  assert.equal(sb.rows.length, 1, 'only heroes both have 5+ games on');
  assert.equal(sb.rows[0].winner, 'a'); // only the x2 win rate differs (55 vs 40)
  assert.equal(bestHero(heroesB).hero, 'mercy');
  const duo = duoFit({ tank: { gamesPlayed: 50, gamesWon: 30 }, damage: { gamesPlayed: 50, gamesWon: 20 } }, { tank: { gamesPlayed: 50, gamesWon: 35 }, support: { gamesPlayed: 50, gamesWon: 26 } });
  assert.deepEqual([duo[0].roleA, duo[0].roleB], ['tank', 'support']);
  assert.ok(!duo.some(o => o.roleA === 'tank' && o.roleB === 'tank'), 'two players cannot both tank');
  const parts = summaryParts(compareMetrics(dps, careerMetrics(groups(500, 4), 'damage')), 'Iso', 'Kenobi', 'Soldier: 76', 'damage');
  assert.match(parts.points.join(' '), /finishes more kills/);
  assert.match(parts.points.join(' '), /matters most for a damage/);
});
