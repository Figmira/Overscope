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
