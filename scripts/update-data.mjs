#!/usr/bin/env node
// Run by the GitHub Action (and runnable by hand). Writes ONLY public data:
//   data/news.json          – Blizzard news + patch notes (titles, dates, links, thumbnails)
//   data/history/*.json     – one daily copy of Blizzard's public hero-rate tables
//   data/media.json         – official image URLs (+ size / crop box); no images are stored
//   data/ranks/*.json       – today's public hero-rate table for each competitive rank
//   data/map-stats/*.json   – today's public hero-rate table for each competitive map
//   data/catalog.json       – public hero & map descriptions (for the Google-visible pages)
// Nothing about any visitor is ever read or written here.
//
//   node scripts/update-data.mjs            (news + today's history; media if missing/stale)
//   node scripts/update-data.mjs --media    (also rebuild the image list)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatchNotes, parseNewsList, decode } from '../lib/news-parse.mjs';
import { sniff, dimensions, alphaBBox } from '../lib/images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OVERFAST = 'https://overfast-api.tekrop.fr';
const BLIZZARD = 'https://overwatch.blizzard.com';
const UA = 'OverScope/2.0 (unofficial fan site; GitHub Action data refresh)';
const today = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);

async function get(url, { accept = 'application/json', binary = false, tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 && i < tries) { await new Promise(s => setTimeout(s, (Number(r.headers.get('retry-after')) || 20) * 1000)); continue; }
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { final: r.status >= 400 && r.status < 500 });
      if (binary) return Buffer.from(await r.arrayBuffer());
      return accept.includes('json') ? await r.json() : await r.text();
    } catch (e) { if (i >= tries || e.final) throw e; await new Promise(s => setTimeout(s, 3000 * i)); }
  }
}
const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const writeJSON = async (f, v) => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(v, null, 1)); };
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }

// ---------------- news ----------------
async function updateNews() {
  const PATCH = `${BLIZZARD}/en-us/news/patch-notes/`;
  const now = new Date();
  const archives = [1, 2].map(k => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); return `${PATCH}live/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/`; });
  const out = { checkedAt: new Date().toISOString(), patches: [], news: [], sources: [], errors: [] };
  for (const [url, kind] of [[PATCH, 'patch'], ...archives.map(a => [a, 'patch']), [`${BLIZZARD}/en-us/news/`, 'news']]) {
    try {
      const html = await get(url, { accept: 'text/html' });
      const items = kind === 'patch' ? parsePatchNotes(html, url) : parseNewsList(html, url);
      out.sources.push({ url, items: items.length, fetchedAt: Date.now() });
      (kind === 'patch' ? out.patches : out.news).push(...items);
      if (!items.length && !url.includes('/live/')) out.errors.push(`${url}: loaded but nothing could be parsed (page layout may have changed)`);
    } catch (e) { out.sources.push({ url, items: 0, error: e.message }); out.errors.push(`${url}: ${e.message}`); }
  }
  const pd = new Set(); out.patches = out.patches.filter(p => !pd.has(p.date) && pd.add(p.date)).sort((a, b) => b.date.localeCompare(a.date));
  const nt = new Set(); out.news = out.news.filter(n => { const k = n.title.toLowerCase(); return !nt.has(k) && nt.add(k); }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // thumbnails for the newest stories that have none (og:image of the article)
  await pool(out.news.filter(n => !n.image).slice(0, 8), 3, async n => {
    try { const html = await get(n.url, { accept: 'text/html' }); const m = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)/i.exec(html); if (m) n.image = decode(m[1]); } catch { /* optional */ }
  });
  out.ok = out.patches.length + out.news.length > 0;
  const file = path.join(DATA, 'news.json');
  if (!out.ok) {
    // keep the previous good copy, but say it is stale
    const prev = await readJSON(file, null);
    if (prev?.ok) { prev.stale = true; prev.errors = out.errors; await writeJSON(file, prev); log('✗ news: kept previous copy —', out.errors.join(' | ')); return; }
  }
  await writeJSON(file, out);
  log(`✓ news: ${out.patches.length} patch notes, ${out.news.length} news${out.errors.length ? ' · ' + out.errors.join(' | ') : ''}`);
}

// ---------------- daily public stat history ----------------
async function updateHistory() {
  for (const queue of ['competitive', 'quickplay']) for (const platform of ['pc', 'console']) for (const region of ['americas', 'europe', 'asia']) {
    const file = path.join(DATA, 'history', `${queue}-${platform}-${region}.json`);
    const hist = await readJSON(file, { queue, platform, region, note: 'Daily copy of Blizzard\'s public hero-rate table (all ranks, all roles, all maps). Public aggregate data only.', snapshots: [] });
    if (hist.snapshots.some(s => s.day === today)) continue;
    try {
      const rows = await statRows({ platform, gamemode: queue, region });
      if (rows.length < 20) throw new Error(`only ${rows.length} rows`);
      hist.snapshots.push({ day: today, rows });
      hist.snapshots = hist.snapshots.slice(-400);
      await writeJSON(file, hist);
      log(`✓ history ${queue}/${platform}/${region}: ${rows.length} heroes saved for ${today}`);
    } catch (e) { log(`✗ history ${queue}/${platform}/${region}: ${e.message}`); }
  }
}

// ---------------- public tables by rank and by map (once a day) ----------------
const RANKS = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster'];
const RANKED_MODES = ['control', 'escort', 'hybrid', 'push', 'flashpoint', 'clash'];
const cleanRows = raw => (Array.isArray(raw) ? raw : []).map(x => ({ hero: x.hero, pickrate: x.pickrate ?? null, winrate: x.winrate ?? null, banrate: x.banrate ?? null })).filter(x => x.hero && Number.isFinite(x.pickrate) && Number.isFinite(x.winrate));
// OverFast sometimes caches an empty answer for one spelling of a URL for up to an hour.
// Asking with the parameters in a different order reaches a different cache entry.
async function statRows(params) {
  const ask = order => get(`${OVERFAST}/heroes/stats?${order.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`);
  const pairs = Object.entries(params).filter(([, v]) => v);
  let rows = cleanRows(await ask(pairs));
  if (rows.length < 20) rows = cleanRows(await ask([...pairs].reverse()));
  return rows;
}
const sameDay = f => f?.fetchedAt && f.fetchedAt.slice(0, 10) === today;

async function updateRanks() {
  for (const platform of ['pc', 'console']) for (const region of ['americas', 'europe', 'asia']) {
    const file = path.join(DATA, 'ranks', `competitive-${platform}-${region}.json`);
    if (sameDay(await readJSON(file, null))) continue;
    const out = { queue: 'competitive', platform, region, note: 'Blizzard\'s public hero-rate table for each rank (all roles, all maps). Public aggregate data only.', fetchedAt: new Date().toISOString(), divisions: {} };
    try {
      await pool(RANKS, 2, async d => {
        const rows = await statRows({ platform, gamemode: 'competitive', region, competitive_division: d });
        if (rows.length < 20) throw new Error(`${d}: only ${rows.length} rows`);
        out.divisions[d] = rows;
      });
      await writeJSON(file, out);
      await appendRankHistory(platform, region, out.divisions, today);
      log(`✓ ranks ${platform}/${region}: ${RANKS.length} rank tables saved (+ daily history)`);
    } catch (e) { log(`✗ ranks ${platform}/${region}: ${e.message} (previous copy kept)`); }
  }
}

// One small file per rank keeps a daily copy, so hero pages can chart a rank over time.
// Rows are compact: [hero, pickrate, winrate, banrate]. Public aggregate data only.
async function appendRankHistory(platform, region, divisions, day) {
  for (const [division, rows] of Object.entries(divisions)) {
    const file = path.join(DATA, 'history-ranks', `competitive-${platform}-${region}-${division}.json`);
    const h = await readJSON(file, { queue: 'competitive', platform, region, division, note: "Daily copy of Blizzard's public hero-rate table for this rank. Rows: [hero, pick, win, ban].", snapshots: [] });
    if (h.snapshots.some(x => x.day === day)) continue;
    h.snapshots.push({ day, rows: rows.map(r => [r.hero, r.pickrate, r.winrate, r.banrate]) });
    h.snapshots = h.snapshots.slice(-400);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(h));
  }
}
async function writeHistoryIndex() {
  // Which history files exist and how many days each holds (lets pages hide empty options).
  const idx = { generatedAt: new Date().toISOString(), allRanks: {}, ranks: {} };
  for (const f of await fs.readdir(path.join(DATA, 'history')).catch(() => [])) {
    const h = await readJSON(path.join(DATA, 'history', f), null); if (h) idx.allRanks[f.replace('.json', '')] = h.snapshots.length;
  }
  for (const f of await fs.readdir(path.join(DATA, 'history-ranks')).catch(() => [])) {
    const h = await readJSON(path.join(DATA, 'history-ranks', f), null); if (h) idx.ranks[f.replace('.json', '')] = h.snapshots.length;
  }
  await writeJSON(path.join(DATA, 'history-index.json'), idx);
}

async function updateMapStats(catalog) {
  // One combination only (PC · Americas · Role Queue) – used for the Google-visible map pages.
  const file = path.join(DATA, 'map-stats', 'competitive-pc-americas.json');
  if (sameDay(await readJSON(file, null))) return;
  const maps = (catalog?.maps || []).filter(m => m.gamemodes.some(g => RANKED_MODES.includes(g)));
  const out = { queue: 'competitive', platform: 'pc', region: 'americas', note: 'Blizzard\'s public hero-rate table for each map (all ranks). Public aggregate data only.', fetchedAt: new Date().toISOString(), maps: {} };
  await pool(maps, 2, async m => {
    try { const rows = await statRows({ platform: 'pc', gamemode: 'competitive', region: 'americas', map: m.key }); if (rows.length >= 20) out.maps[m.key] = rows; }
    catch (e) { log(`✗ map stats ${m.key}: ${e.message}`); }
  });
  if (Object.keys(out.maps).length) { await writeJSON(file, out); log(`✓ map stats: ${Object.keys(out.maps).length} maps saved`); }
}

async function updateCatalog() {
  const file = path.join(DATA, 'catalog.json');
  const prev = await readJSON(file, null);
  if (prev && Date.now() - Date.parse(prev.generatedAt) < 6 * 86400_000 && !process.argv.includes('--media')) return prev;
  const roster = (await get(`${OVERFAST}/heroes`)).filter(h => h.key && ['tank', 'damage', 'support'].includes(h.role));
  const heroes = {};
  await pool(roster, 3, async h => {
    try {
      const d = await get(`${OVERFAST}/heroes/${h.key}`);
      heroes[h.key] = { name: d.name || h.name, role: d.role || h.role, description: d.description || '', location: d.location || '', age: d.age ?? null,
        hitpoints: d.hitpoints ? { total: d.hitpoints.total ?? null, health: d.hitpoints.health ?? null, armor: d.hitpoints.armor ?? null, shields: d.hitpoints.shields ?? null } : null,
        abilities: (d.abilities || []).map(a => ({ name: a.name || '', description: a.description || '' })).filter(a => a.name) };
    } catch (e) { heroes[h.key] = prev?.heroes?.[h.key] || { name: h.name, role: h.role, description: '', abilities: [] }; log(`✗ catalog hero ${h.key}: ${e.message}`); }
  });
  const maps = (await get(`${OVERFAST}/maps`)).map(m => ({ key: m.key, name: m.name, location: m.location || '', country: m.country_code || '', gamemodes: m.gamemodes || [] })).filter(m => m.key && m.name);
  const out = { generatedAt: new Date().toISOString(), note: 'Public hero and map descriptions from Blizzard via OverFast.', heroes, maps };
  await writeJSON(file, out);
  log(`✓ catalog: ${Object.keys(heroes).length} heroes, ${maps.length} maps`);
  return out;
}

// ---------------- official image URL list ----------------
function pageImages(html) {
  const out = [];
  const og = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (og) out.push(decode(og[1]));
  for (const m of html.matchAll(/https:\/\/blz-contentstack-images\.akamaized\.net\/[^"'\s)>]+?\.(?:png|jpg|jpeg|webp)/gi)) out.push(decode(m[0]));
  return [...new Set(out)];
}
async function probe(url, { accept = 'image/png,image/jpeg;q=0.9', alpha = false, minW = 64 } = {}) {
  const buf = await get(url, { accept, binary: true });
  const type = sniff(buf); const dim = dimensions(buf, type);
  if (!type || type === 'svg' || !dim || dim.width < minW) throw new Error('not a usable image');
  const out = { url, width: dim.width, height: dim.height, type };
  if (alpha) { if (!(type === 'png' && [4, 6].includes(buf[25]))) throw new Error('not a transparent PNG'); out.bbox = await alphaBBox(buf); }
  return out;
}

async function updateMedia() {
  const media = { generatedAt: new Date().toISOString(), note: 'Official image URLs only. Images are served by Blizzard / OverFast, not stored here.', heroes: {}, heroArt: {}, cutouts: {}, maps: {}, backgrounds: {}, failures: [] };
  const fail = (kind, key, e) => { media.failures.push({ kind, key, error: e.message || String(e) }); log(`✗ ${kind} ${key}: ${e.message || e}`); };
  const roster = (await get(`${OVERFAST}/heroes`)).filter(h => h.key && h.portrait);
  await pool(roster, 4, async h => {
    try { const p = await probe(h.portrait); media.heroes[h.key] = { name: h.name, role: h.role, url: p.url, width: p.width, height: p.height }; }
    catch (e) { fail('portrait', h.key, e); }
  });
  const pages = new Map();
  await pool(roster, 3, async h => { try { pages.set(h.key, pageImages(await get(`${BLIZZARD}/en-us/heroes/${h.key}/`, { accept: 'text/html' }))); } catch (e) { pages.set(h.key, []); fail('hero-page', h.key, e); } });
  let home = []; try { home = pageImages(await get(`${BLIZZARD}/en-us/`, { accept: 'text/html' })); } catch (e) { fail('homepage', 'home', e); }
  const freq = new Map(); for (const imgs of pages.values()) for (const u of new Set(imgs)) freq.set(u, (freq.get(u) || 0) + 1);
  const fileOf = u => decodeURIComponent(u.split('?')[0].split('/').pop()).toLowerCase();
  const norm = x => x.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const ALIAS = { 'soldier-76': ['soldier76', 'soldier'], widowmaker: ['widowmaker', 'widow'], 'junker-queen': ['junkerqueen'], 'wrecking-ball': ['wreckingball', 'hammond'] };
  const allPng = [...new Set([...home, ...[...pages.values()].flat()])].filter(u => /\.png$/i.test(u.split('?')[0]));
  await pool(roster, 3, async h => {
    const own = (pages.get(h.key) || []).filter(u => (freq.get(u) || 0) <= 2 && /\.(jpe?g|png)$/i.test(u.split('?')[0]));
    const ranked = [...own.filter(u => /^2600_/.test(fileOf(u))), ...own.filter(u => /^1600_/.test(fileOf(u)))];
    for (const u of ranked.slice(0, 2)) { try { const p = await probe(u, { minW: 1200 }); media.heroArt[h.key] = { url: p.url, width: p.width, height: p.height }; break; } catch { /* next */ } }
    if (!media.heroArt[h.key]) fail('hero-art', h.key, new Error('no large official art found'));
    const code = ranked[0] ? norm(fileOf(ranked[0]).replace(/^(2600|1600|960)_/, '').replace(/\.(png|jpe?g)$/, '')) : '';
    const names = [...new Set([norm(h.key), norm(h.name), ...(ALIAS[h.key] || []), code].filter(Boolean))];
    const cand = allPng.filter(u => !/^(2600|1600|960)_/.test(fileOf(u))).filter(u => { const f = norm(fileOf(u).replace(/\.png$/, '').replace(/^(tank|damage|support)_-_/, '')); return names.some(n => f === n || f === n + 'withouticeblast' || f === 'edited' + n); });
    let best = null;
    for (const u of cand.slice(0, 4)) { try { const p = await probe(u, { alpha: true, minW: 600 }); if (!best || p.width * p.height > best.width * best.height) best = p; } catch { /* thumbnails etc. */ } }
    if (best) media.cutouts[h.key] = { url: best.url, width: best.width, height: best.height, bbox: best.bbox };
  });
  const maps = await get(`${OVERFAST}/maps`);
  await pool(maps, 4, async m => {
    try { const p = await probe(m.screenshot, { minW: 400 }); media.maps[m.key] = { name: m.name, url: p.url, width: p.width, height: p.height }; }
    catch (e) { fail('map', m.key, e); }
  });
  if (media.maps['lijiang-tower']) media.backgrounds.home = { ...media.maps['lijiang-tower'], note: 'Lijiang Tower night skyline (official map screenshot)' };
  await writeJSON(path.join(DATA, 'media.json'), media);
  log(`✓ media: ${Object.keys(media.heroes).length} portraits, ${Object.keys(media.heroArt).length} hero art, ${Object.keys(media.cutouts).length} cutouts, ${Object.keys(media.maps).length} maps, ${media.failures.length} failures`);
}

const prevMedia = await readJSON(path.join(DATA, 'media.json'), null);
const mediaAge = prevMedia ? Date.now() - Date.parse(prevMedia.generatedAt) : Infinity;
await updateNews().catch(e => log('✗ news failed:', e.message));
await updateHistory().catch(e => log('✗ history failed:', e.message));
const catalog = await updateCatalog().catch(e => { log('✗ catalog failed:', e.message); return null; });
await updateRanks().catch(e => log('✗ ranks failed:', e.message));
await updateMapStats(catalog || await readJSON(path.join(DATA, 'catalog.json'), null)).catch(e => log('✗ map stats failed:', e.message));
// seed per-rank history from today's saved rank tables (first run after this feature was added)
for (const f of await fs.readdir(path.join(DATA, 'ranks')).catch(() => [])) {
  const r = await readJSON(path.join(DATA, 'ranks', f), null);
  if (r?.divisions && r.fetchedAt) await appendRankHistory(r.platform, r.region, r.divisions, r.fetchedAt.slice(0, 10)).catch(() => {});
}
await writeHistoryIndex().catch(e => log('✗ history index failed:', e.message));
if (process.argv.includes('--media') || mediaAge > 6 * 86400_000) await updateMedia().catch(e => log('✗ media failed:', e.message));
else log(`· media list is ${Math.round(mediaAge / 3600_000)} h old — kept (rebuilt weekly or with --media)`);
