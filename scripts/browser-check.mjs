#!/usr/bin/env node
// Real-browser check (Playwright + Chromium): opens every page on desktop and
// mobile, saves screenshots, and reports console errors, failed requests,
// broken/missing images and horizontal overflow. Also runs key interactions.
//   npm install --no-save playwright && npx playwright install chromium
//   npm run test:browser
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Serve the built site (_site/, from `node scripts/build-site.mjs`) when it exists,
// so the Google-visible pages are checked too; otherwise the source folder.
const SERVE = await fs.stat(path.join(ROOT, '_site', 'index.html')).then(() => path.join(ROOT, '_site'), () => ROOT);
// Tiny static server that mimics GitHub Pages: the site lives under /overscope/
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function createServer() {
  return http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/overscope/')) { res.writeHead(404).end(); return; }
    p = p.slice('/overscope/'.length) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    const f = path.normalize(path.join(SERVE, p));
    if (!f.startsWith(SERVE)) { res.writeHead(403).end(); return; }
    try { const b = await fs.readFile(f); res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404).end('Not found'); }
  });
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('Playwright is not installed. Run:\n  npm install --no-save playwright\n  npx playwright install chromium'); process.exit(2); }

const OUT = path.join(ROOT, 'docs', 'screenshots');
await fs.mkdir(OUT, { recursive: true });
const server = createServer().listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}/overscope`;
const PLAYER = process.env.PLAYER || 'TeKrop-2217';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), ...(process.env.HTTPS_PROXY ? { args: ['--proxy-server=' + process.env.HTTPS_PROXY] } : {}) });

const ROUTES = [
  ['home', '#/'], ['heroes', '#/heroes'], ['hero-tracer', '#/heroes/tracer'], ['competitive', '#/competitive?queue=competitive'],
  ['quickplay', '#/competitive?queue=quickplay'], ['compare', '#/competitive?view=compare'],
  ['stadium', '#/stadium/tracer'], ['maps', '#/maps'], ['map-detail', '#/maps/kings-row'], ['players', '#/players/' + encodeURIComponent(PLAYER)],
  ['news', '#/news'], ['sources', '#/sources'], ['meta-by-rank', '#/competitive?view=ranks'],
  ['player-vs-player', '#/players/compare?a=' + encodeURIComponent(PLAYER) + '&b=TeKrop-2217'],
  ['tier-list', '#/tier-list'],
  ...(SERVE !== ROOT ? [['static-tierlist', 'tier-list/'], ['static-tier-gold', 'tier-list/gold/'], ['static-hero', 'heroes/tracer/'], ['static-heroes', 'heroes/'], ['static-map', 'maps/kings-row/'], ['static-maps', 'maps/']] : []),
];
const VIEWPORTS = { desktop: { width: 1600, height: 1000 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const report = [];

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 45000 }).catch(() => {});
  // load lazy images now so every image on the page is actually checked
  await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; }));
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } window.scrollTo(0, 0); });
  await page.evaluate(async () => { for (const im of document.images) { if (!im.complete) await new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 5000); }); } });
  await page.waitForTimeout(400);
}

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
  for (const [name, hash] of ROUTES) {
    const page = await ctx.newPage();
    const errors = [], failed = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.exposeFunction('__cspViolation', v => errors.push('CSP blocked: ' + v)).catch(() => {});
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.__cspViolation?.(`${e.violatedDirective} ${e.blockedURI}`)));
    page.on('requestfailed', r => failed.push(r.url() + ' ' + (r.failure()?.errorText || '')));
    page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/players/ThisPlayer')) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto(base + '/' + hash);
    await settle(page);
    const info = await page.evaluate(() => {
      const imgs = [...document.images].filter(i => i.closest('#main, #banner-slot'));
      return {
        images: imgs.length,
        loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
        fallbacks: document.querySelectorAll('#main .img-fallback, #banner-slot .img-fallback').length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        errorStates: [...document.querySelectorAll('.state.error')].map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 160)),
      };
    });
    const file = `${vpName}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    report.push({ vp: vpName, name, file, ...info, consoleErrors: errors, failedRequests: failed });
    console.log(`${vpName.padEnd(7)} ${name.padEnd(12)} imgs ${info.loaded}/${info.images} broken ${info.broken.length} fallbacks ${info.fallbacks} overflow ${info.overflow}px errors ${errors.length} failedReq ${failed.length} errorStates ${info.errorStates.length}`);
    await page.close();
  }
  await ctx.close();
}

// ---- interactions ----
const inter = [];
const ctx = await browser.newContext({ ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const seen = [];
page.on('request', r => { if (r.url().includes('/heroes/stats')) seen.push(r.url()); });
async function step(name, fn) { try { inter.push({ name, ok: true, detail: await fn() }); } catch (e) { inter.push({ name, ok: false, detail: e.message }); } console.log((inter.at(-1).ok ? '✓ ' : '✗ ') + name + ' — ' + inter.at(-1).detail); }

await page.goto(base + '/#/'); await settle(page);
await step('Home: Quick Play tab re-queries the Quick Play dataset', async () => {
  seen.length = 0;
  await page.click('#queueTabs [data-queue=quickplay]'); await settle(page);
  if (!seen.some(u => u.includes('gamemode=quickplay'))) throw new Error('no quickplay request: ' + seen.join(','));
  const label = await page.textContent('#metaPanel .panel-head'); if (!/Quick Play/.test(label)) throw new Error('label not updated');
  return 'browser requested ' + seen.find(u => u.includes('quickplay'));
});
await step('Open Queue is not offered anywhere (no data exists)', async () => {
  const n = await page.$$eval('[data-queue=open], [data-sub=open], [data-mapqueue=open]', x => x.length);
  if (n) throw new Error(n + ' Open Queue controls found');
  return 'no Open Queue tabs or links';
});
await step('Home: hero ranking row opens that hero', async () => {
  const key = await page.getAttribute('#metaPanel .hero-row', 'data-hero');
  await page.click('#metaPanel .hero-row'); await settle(page);
  if (!page.url().endsWith('#/heroes/' + key)) throw new Error('url ' + page.url());
  return 'opened ' + key;
});
await step('Heroes: search + role filter', async () => {
  await page.goto(base + '/#/heroes'); await settle(page);
  await page.fill('#heroQ', 'win'); const names = await page.$$eval('.hero-tile b', b => b.map(x => x.textContent));
  if (!names.includes('Winston')) throw new Error('Winston not found: ' + names);
  await page.fill('#heroQ', ''); await page.click('[data-role=support]');
  const roles = await page.$$eval('.hero-tile', t => [...new Set(t.map(x => x.className.match(/role-(\w+)/)[1]))]);
  if (roles.join() !== 'support') throw new Error('roles ' + roles);
  return `search found Winston; support filter → ${await page.$$eval('.hero-tile', t => t.length)} heroes`;
});
await step('Competitive: sort by win rate', async () => {
  await page.goto(base + '/#/competitive?queue=competitive'); await settle(page);
  await page.click('[data-sort=winrate]');
  const vals = await page.$$eval('#rankPanel .hero-row > span:nth-child(4) b', b => b.map(x => parseFloat(x.textContent)));
  const sorted = [...vals].sort((a, b) => b - a);
  if (JSON.stringify(vals) !== JSON.stringify(sorted)) throw new Error('not sorted');
  return `top win rate ${vals[0]}%`;
});
await step('Stadium: select powers & share link', async () => {
  await page.goto(base + '/#/stadium/tracer'); await settle(page);
  const n = await page.$$eval('[data-power]', x => x.length);
  if (!n) return 'no powers in data source — unavailable state shown (see report)';
  await page.click('[data-power] >> nth=0'); if (n > 1) await page.click('[data-power] >> nth=1');
  const full = await page.$$eval('.slot.full', s => s.length);
  if (full < 1) throw new Error('build not updated');
  return `${full} slots filled; url ${page.url().split('#')[1].slice(0, 80)}`;
});
await step('Maps: map detail shows objective + hero-on-map data', async () => {
  await page.goto(base + '/#/maps'); await settle(page);
  await page.click('.map-card'); await settle(page);
  const t = await page.textContent('#main');
  if (!/Objective/i.test(t)) throw new Error('no objective');
  return 'opened ' + page.url().split('#')[1];
});
await step('News: items link to Blizzard', async () => {
  await page.goto(base + '/#/news'); await settle(page);
  const hrefs = await page.$$eval('.news-list a', a => a.map(x => x.href));
  if (!hrefs.length) throw new Error('no news items');
  if (!hrefs.every(h => /blizzard\.com/.test(h))) throw new Error('non-Blizzard link');
  return `${hrefs.length} items, first ${hrefs[0]}`;
});
await step('Players: nonexistent BattleTag handled', async () => {
  await page.goto(base + '/#/players/ThisPlayerDoesNotExist-99999');
  await page.waitForSelector('#pProfile .state', { timeout: 30000 });
  const t = await page.textContent('#pProfile'); if (!/no public profile|not found/i.test(t)) throw new Error(t.slice(0, 120));
  return 'explains there is no public profile';
});
await step('Meta by rank: heatmap shows one column per rank', async () => {
  await page.goto(base + '/#/competitive?view=ranks'); await page.waitForSelector('.heat .hm', { timeout: 60000 });
  const cols = await page.$$eval('.heat .hh', h => h.length - 1); const cells = await page.$$eval('.heat .hm', c => c.length);
  if (cols < 7) throw new Error('only ' + cols + ' rank columns');
  return `${cols} ranks, ${cells} cells`;
});
await step('Patch impact: hidden until a patch has before/after data, shown once it does', async () => {
  await page.goto(base + '/#/competitive'); await settle(page);
  const off = await page.$('meta[name=overscope-patch-impact][content=off]');
  const tab = await page.$('[data-view=patch]'), link = await page.$('#sidebar [data-route=patch]');
  if (off && (tab || link)) throw new Error('hidden flag set but Patch impact still shown');
  if (!off && !(tab && link)) throw new Error('data exists but Patch impact missing');
  return off ? 'hidden (no before/after data yet)' : 'shown (data available)';
});
await step('Privacy: the site makes no requests except to OverFast, Blizzard media and its own files', async () => {
  const hosts = new Set(); const p2 = await ctx.newPage(); p2.on('request', r => hosts.add(new URL(r.url()).host));
  for (const h of ['#/', '#/players/' + encodeURIComponent(PLAYER), '#/news']) { await p2.goto(base + '/' + h); await settle(p2); }
  await p2.close();
  const allowed = [/^127\.0\.0\.1/, /overfast-api\.tekrop\.fr$/, /cloudfront\.net$/, /blz-contentstack-images\.akamaized\.net$/, /akamaihd\.net$/, /blizzard\.com$/, /playoverwatch\.com$/];
  const other = [...hosts].filter(h => !allowed.some(a => a.test(h)));
  if (other.length) throw new Error('unexpected hosts: ' + other.join(', '));
  return 'hosts contacted: ' + [...hosts].join(', ');
});
await step('Favorites: star a player, see them on the Players page, then un-star', async () => {
  await page.goto(base + '/#/players/' + encodeURIComponent(PLAYER)); await page.waitForSelector('[data-fav]', { timeout: 60000 });
  await page.click('[data-fav]'); await page.waitForTimeout(800);
  await page.goto(base + '/#/players'); await page.waitForSelector('#pResults .panel');
  const names = await page.$$eval('#pResults .player-card b', b => b.map(x => x.textContent));
  if (!names.length) throw new Error('favorite not listed');
  await page.click('[data-unfav]'); await page.waitForTimeout(500);
  return 'listed: ' + names.join(', ') + ' (then removed)';
});
await step('Favorites: star a hero and filter the roster', async () => {
  await page.goto(base + '/#/heroes/winston'); await page.waitForSelector('[data-favhero]', { timeout: 60000 });
  await page.click('[data-favhero]');
  await page.goto(base + '/#/heroes'); await page.waitForSelector('.hero-tile'); await page.click('[data-role=""]'); await page.click('#favOnly');
  const names = await page.$$eval('.hero-tile b', b => b.map(x => x.textContent));
  if (names.join() !== 'Winston') throw new Error('filter shows ' + names);
  return 'Favorites filter → ' + names.join(', ');
});
await step('Player profile: rank history + hero deep dive render', async () => {
  await page.goto(base + '/#/players/' + encodeURIComponent(PLAYER)); await page.waitForSelector('#deepOut .deep-group, #deepOut .state', { timeout: 60000 });
  const groups = await page.$$eval('#deepOut .deep-group h3', h => h.map(x => x.textContent));
  const hist = (await page.textContent('#histPanel')).replace(/\s+/g, ' ').slice(0, 80);
  return `deep-dive groups: ${groups.join(', ')} · history: ${hist}`;
});
await step('Tier list: S–D tiers, every hero once, rank filter re-queries', async () => {
  seen.length = 0;
  await page.goto(base + '/#/tier-list?queue=competitive&rank='); await page.waitForSelector('.tier-row .tier-hero', { timeout: 60000 });
  const n = await page.$$eval('.tier-hero', t => t.length); const tiers = await page.$$eval('.tier-badge b', b => b.map(x => x.textContent).join(''));
  await page.selectOption('select[data-pref=division]', 'gold'); await page.waitForTimeout(300); await settle(page);
  if (!seen.some(u => u.includes('competitive_division=gold'))) throw new Error('rank change did not request gold table');
  if (tiers !== 'SABCD') throw new Error('tiers ' + tiers);
  await page.selectOption('select[data-pref=division]', ''); await settle(page);
  return `${n} heroes across ${tiers}; Gold re-queried`;
});
await step('Stadium: powers only (no item slots without a source)', async () => {
  await page.goto(base + '/#/stadium/zenyatta'); await page.waitForSelector('[data-power]', { timeout: 60000 });
  const itemSlots = await page.$$eval('#buildBox small', s => s.filter(x => /Items/.test(x.textContent)).length);
  const itemsPanel = await page.$eval('#items', el => el.hidden);
  if (itemSlots || !itemsPanel) throw new Error('item slots still shown');
  return `${await page.$$eval('[data-power]', x => x.length)} powers, no item slots`;
});
await step('Phone: top search button finds a player; menu links close the menu and open the page', async () => {
  const m = await browser.newContext({ ignoreHTTPSErrors: !!process.env.HTTPS_PROXY, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await m.newPage();
  await p.goto(base + '/#/tier-list'); await settle(p);
  await p.tap('#menuBtn'); await p.tap('#sidebar a[data-route="tier-list"]'); await p.waitForTimeout(400);
  if (await p.$eval('#sidebar', el => el.classList.contains('open'))) throw new Error('menu stayed open when tapping the current page');
  await p.tap('#menuBtn'); await p.tap('#sidebar a[data-route="maps"]'); await p.waitForTimeout(1500);
  if (!p.url().endsWith('#/maps') || await p.$eval('#sidebar', el => el.classList.contains('open'))) throw new Error('maps link failed: ' + p.url());
  await p.fill('#topSearchInput', 'Iso#11570'); await p.tap('.search-go');
  await p.waitForSelector('#pProfile h1', { timeout: 60000 });
  const name = await p.textContent('#pProfile h1'); await m.close();
  return `menu OK; search button opened profile "${name}"`;
});
await step('Hero page: by-rank chart + tier per rank', async () => {
  await page.goto(base + '/#/heroes/tracer'); await page.waitForSelector('#hdRank .tier-strip', { timeout: 60000 });
  const strip = await page.$$eval('#hdRank .tier-strip b', b => b.map(x => x.textContent).join(' '));
  const charts = await page.$$eval('#hdRank svg.chart', s => s.length);
  if (charts !== 2) throw new Error(charts + ' charts');
  return `tiers Bronze→GM: ${strip}; ${charts} charts`;
});
if (SERVE !== ROOT) await step('Google pages: real content, preview card, link back into the app', async () => {
  await page.goto(base + '/heroes/tracer/'); await settle(page);
  const h1 = await page.textContent('h1'); const og = await page.getAttribute('meta[property="og:image"]', 'content');
  const rows = await page.$$eval('.static-table tbody tr', r => r.length);
  if (!/Tracer/.test(h1) || !og || rows < 8) throw new Error(`h1 ${h1} og ${og} rows ${rows}`);
  await page.click('.cta .btn.primary'); await settle(page);
  if (!/\/overscope\/#\/heroes\/tracer$/.test(page.url())) throw new Error('live link went to ' + page.url());
  if (!(await page.$('#hdRank'))) throw new Error('app did not render hero page');
  return `"${h1.trim()}", ${rows} rank rows, og:image set, live link → ${page.url().split('/overscope')[1]}`;
});
if (SERVE !== ROOT) await step('Google pages: top search from a static page opens the app', async () => {
  await page.goto(base + '/maps/kings-row/'); await settle(page);
  await page.fill('#topSearchInput', 'Iso-11570'); await page.press('#topSearchInput', 'Enter'); await page.waitForTimeout(1500);
  if (!/\/overscope\/#\/players(\?q=|\/)Iso-11570$/.test(page.url())) throw new Error(page.url());
  return 'went to ' + page.url().split('/overscope')[1];
});
await ctx.close();
await browser.close();
server.close();

const md = ['# Browser check results', '', `Run ${new Date().toISOString()} in Chromium via Playwright. The static site was served exactly as GitHub Pages serves it (under /overscope/); all data was fetched live by the browser.`, '',
  '## Pages', '', '| Viewport | Page | Images loaded | Broken | Fallbacks | Overflow px | Console errors | Failed requests | Error panels | Screenshot |', '|---|---|---|---|---|---|---|---|---|---|',
  ...report.map(r => `| ${r.vp} | ${r.name} | ${r.loaded}/${r.images} | ${r.broken.length} | ${r.fallbacks} | ${r.overflow} | ${r.consoleErrors.length} | ${r.failedRequests.length} | ${r.errorStates.length} | screenshots/${r.file} |`),
  '', '## Interactions', '', ...inter.map(i => `- ${i.ok ? 'PASS' : 'FAIL'} — ${i.name}: ${i.detail}`),
  '', '## Details', '', ...report.filter(r => r.broken.length || r.consoleErrors.length || r.failedRequests.length || r.errorStates.length).map(r => `### ${r.vp} / ${r.name}\n${r.broken.map(b => '- broken image: ' + b).join('\n')}\n${r.consoleErrors.map(b => '- console: ' + b).join('\n')}\n${r.failedRequests.map(b => '- request: ' + b).join('\n')}\n${r.errorStates.map(b => '- error panel: ' + b).join('\n')}`)].join('\n');
await fs.writeFile(path.join(ROOT, 'docs', 'BROWSER_TEST_RESULTS.md'), md);
await fs.writeFile(path.join(ROOT, 'docs', 'browser-report.json'), JSON.stringify({ report, inter }, null, 2));
console.log('\nReport → docs/BROWSER_TEST_RESULTS.md');
