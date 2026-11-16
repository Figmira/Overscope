#!/usr/bin/env node
// Builds the folder GitHub Pages publishes (_site/). It copies the app and adds
// real, Google-visible pages (heroes, maps, tier lists) with preview cards for
// Discord/X, plus sitemap.xml and robots.txt. Uses ONLY the public data files in
// data/ — no visitor data exists anywhere in this process.
//
//   SITE_URL=https://example.github.io/overscope/ node scripts/build-site.mjs
//
// SITE_URL is filled in automatically by the GitHub Action. Without it the pages
// are still built, but without absolute links (sitemap is skipped).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { computeTiers, groupTiers, METHOD } from '../js/tiers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const SITE = (process.env.SITE_URL || '').replace(/\/?$/, '/').replace(/^\/$/, '');
const RANKS = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster'];
const RANKED_MODES = ['control', 'escort', 'hybrid', 'push', 'flashpoint', 'clash'];
const COPY = ['index.html', 'favicon.svg', '.nojekyll', 'css', 'js', 'fonts', 'data'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = n => (Number.isFinite(n) ? n.toFixed(1) + '%' : '—');
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const ROLE = { tank: 'Tank', damage: 'Damage', support: 'Support' };
const readJSON = async (f, d = null) => { try { return JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8')); } catch { return d; } };
const fmtDay = iso => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const sized = (url, w) => (url && /blz-contentstack-images/.test(url) ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : url || '');

// ---------- load public data ----------
const media = await readJSON('data/media.json', { heroes: {}, heroArt: {}, maps: {} });
const catalog = await readJSON('data/catalog.json', { heroes: {}, maps: [] });
const ranks = await readJSON('data/ranks/competitive-pc-americas.json');
const mapStats = await readJSON('data/map-stats/competitive-pc-americas.json');
const histComp = await readJSON('data/history/competitive-pc-americas.json');
const histQP = await readJSON('data/history/quickplay-pc-americas.json');
const modes = await readJSON('data/modes.json', {});
const latest = h => h?.snapshots?.at(-1) || null;
const comp = latest(histComp), qp = latest(histQP);
const heroKeys = Object.keys(catalog.heroes).filter(k => ROLE[catalog.heroes[k].role]).sort((a, b) => catalog.heroes[a].name.localeCompare(catalog.heroes[b].name));
const roleOf = k => catalog.heroes[k]?.role || media.heroes[k]?.role;
const nameOf = k => catalog.heroes[k]?.name || media.heroes[k]?.name || k;
const rankedMaps = (catalog.maps || []).filter(m => m.gamemodes.some(g => RANKED_MODES.includes(g)));

// ---------- money switches (site.config.json; both OFF by default) ----------
const config = await readJSON('site.config.json', {});
const TIP_HOSTS = ['ko-fi.com', 'buymeacoffee.com', 'www.buymeacoffee.com', 'github.com', 'patreon.com', 'www.patreon.com', 'liberapay.com'];
const tipUrl = (() => {
  const raw = config.tip?.url?.trim(); if (!raw) return '';
  let u; try { u = new URL(raw); } catch { throw new Error(`site.config.json: tip.url is not a web address: ${raw}`); }
  if (u.protocol !== 'https:' || !TIP_HOSTS.includes(u.hostname) || (u.hostname === 'github.com' && !u.pathname.startsWith('/sponsors/'))) throw new Error(`site.config.json: tip.url must be an https Ko-fi, Buy Me a Coffee, GitHub Sponsors, Patreon or Liberapay page (got ${raw})`);
  return u.href;
})();
const tipLabel = config.tip?.label || 'Support OverScope';
const ads = config.ads || {};
if (ads.enabled && !ads.consentReady) throw new Error('site.config.json: ads.enabled is true but ads.consentReady is not. Ad networks track visitors, so a cookie-consent pop-up must be set up first. The live site was left unchanged.');
const adHosts = ads.enabled ? (ads.hosts || []).map(h => { const u = new URL(h); if (u.protocol !== 'https:') throw new Error(`ads.hosts must be https: ${h}`); return u.origin; }) : [];
const inlineHashes = html => [...String(html || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const adHashes = ads.enabled ? [...inlineHashes(ads.headHtml), ...inlineHashes(ads.slotHtml)] : [];
const withAds = csp => (!ads.enabled ? csp : csp
  .replace(/script-src ([^;]+)/, (m, v) => `script-src ${v} ${[...adHosts, ...adHashes].join(' ')}`)
  .replace(/img-src ([^;]+)/, (m, v) => `img-src ${v} ${adHosts.join(' ')}`)
  .replace(/connect-src ([^;]+)/, (m, v) => `connect-src ${v} ${adHosts.join(' ')}`)
  .replace(/media-src 'none'/, `media-src ${adHosts.join(' ') || "'none'"}`)
  + `; frame-src ${adHosts.join(' ')}`);
const adSlot = ads.enabled ? `<aside class="ad-slot" aria-label="Advertisement"><span class="ad-label">Advertisement</span>${ads.slotHtml || ''}</aside>\n  ` : '';

// ---------- page shell (topbar/sidebar/footer taken from index.html) ----------
let indexHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
if (tipUrl) {
  indexHtml = indexHtml
    .replace('<a class="made-by"', `<a class="tip-link" href="${esc(tipUrl)}" target="_blank" rel="noopener">♥ ${esc(tipLabel)}</a>\n      <a class="made-by"`)
    .replace('· Unofficial fan-made Overwatch analytics</span>', `· <a class="tip-foot" href="${esc(tipUrl)}" target="_blank" rel="noopener">♥ ${esc(tipLabel)}</a> · Unofficial fan-made Overwatch analytics</span>`);
}
if (ads.enabled) indexHtml = indexHtml.replace('<footer class="footer">', adSlot + '<footer class="footer">');
// Patch impact needs a saved copy from before AND after a patch. Until one exists, the
// feature is hidden everywhere (no empty pages).
const newsFile = await readJSON('data/news.json', { patches: [] });
const days = (histComp?.snapshots || []).map(x => x.day);
const measurable = (newsFile.patches || []).filter(p => days.some(d => d < p.date) && days.some(d => d > p.date)).map(p => p.date);
if (!measurable.length) {
  indexHtml = indexHtml.replace(/\s*<a href="#\/competitive\?view=patch"[^\n]*<\/a>/, '')
    .replace('<meta name="referrer"', '<meta name="overscope-patch-impact" content="off">\n  <meta name="referrer"');
}
const between = (a, b) => { const i = indexHtml.indexOf(a), j = indexHtml.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`index.html marker missing: ${a}`); return indexHtml.slice(i, j + b.length); };
const CSP = withAds(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(indexHtml)[1].replace(/ 'sha256-[^']+'/, ''));
const adHead = ads.enabled ? `\n  <meta name="overscope-ads" content="on">\n  ${ads.headHtml || ''}` : '';
const topbar = between('<header class="topbar">', '</header>');
const sidebar = between('<aside class="sidebar"', '</aside>');
const footer = between('<footer class="footer">', '</footer>');
const sprite = between('<svg width="0" height="0"', '</svg>\n');

function page({ rel, title, description, canonical, image, imageAlt, body, active = '' }) {
  const abs = canonical != null && SITE ? SITE + canonical : '';
  const shell = s => s.replace(/ data-route="[^"]*"/g, m => (m === ` data-route="${active}"` ? `${m} class="on"` : m)).replace(/class="on" class="([^"]+)"/g, 'class="$1 on"');
  return `<!DOCTYPE html>
<html lang="en" data-page="static">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080b18">
  <base href="${rel}">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${abs ? `<link rel="canonical" href="${esc(abs)}">\n  <meta property="og:url" content="${esc(abs)}">` : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="OverScope">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">\n  <meta property="og:image:alt" content="${esc(imageAlt || title)}">\n  <meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="preload" href="fonts/barlow-condensed-latin-800-italic.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="css/app.css">${adHead}
</head>
<body data-static="1">
  <a class="skip" href="${esc(canonical || '')}#main">Skip to content</a>
  ${shell(topbar)}
  <div class="shell">
    ${shell(sidebar)}
    <main id="main" class="main" tabindex="-1"><div class="page static-page">
${body}
    </div></main>
  </div>
  ${adSlot}${footer}
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="tooltip" class="tooltip" role="tooltip"></div>
  ${sprite}
  <script type="module" src="js/app.js"></script>
</body>
</html>
`;
}
const updated = day => `<p class="source-note">Updated ${esc(fmtDay(day))} from Blizzard's official hero rates (via OverFast) · Competitive 5v5 Role Queue · PC · Americas. Blizzard does not publish game counts or a Champion table. <a href="#/sources">Sources &amp; method</a></p>`;
const portrait = (k, size = 40) => { const a = media.heroes[k]; return a ? `<img class="portrait" src="${esc(a.url)}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async">` : `<span class="img-fallback portrait role-${esc(roleOf(k) || 'none')}"><b>${esc(nameOf(k)[0])}</b></span>`; };
const heroLink = k => `<a class="tier-hero role-${esc(roleOf(k))}" href="heroes/${esc(k)}/">${portrait(k, 36)}<span><b>${esc(nameOf(k))}</b><small>${esc(ROLE[roleOf(k)] || '')}</small></span></a>`;
const tierBadge = t => `<span class="tier-chip t-${esc(t)}">${esc(t)}</span>`;

const pages = []; // [relativePath, html, priority]
const add = (rel, html, priority = 0.6) => pages.push([rel, html, priority]);

// ---------- tier lists ----------
function tierListPage(rank) {
  const rows = rank ? ranks?.divisions?.[rank] : comp?.rows;
  if (!rows?.length) return;
  const day = rank ? ranks.fetchedAt.slice(0, 10) : comp.day;
  const scored = computeTiers(rows, roleOf);
  const groups = groupTiers(scored);
  const label = rank ? cap(rank) : 'All ranks';
  const top = groups[0].heroes.map(r => nameOf(r.hero)).join(', ');
  const tile = r => `<a class="tier-hero role-${esc(r.role)}" href="heroes/${esc(r.hero)}/">${portrait(r.hero, 36)}<span><b>${esc(nameOf(r.hero))}</b><small>${pct(r.winrate)} win · ${pct(r.pickrate)} pick</small></span></a>`;
  const slug = rank ? `tier-list/${rank}/` : 'tier-list/';
  add(slug, page({
    rel: rank ? '../../' : '../', canonical: slug, active: 'tier-list',
    title: `Overwatch Tier List — ${label} (Competitive Role Queue) | OverScope`,
    description: `Overwatch hero tier list for ${label}, updated ${fmtDay(day)} from Blizzard's official pick and win rates. S tier: ${top}.`,
    image: media.heroArt[groups[0].heroes[0]?.hero] ? sized(media.heroArt[groups[0].heroes[0].hero].url, 1200) : '',
    body: `<header class="page-top"><p class="eyebrow">Tier list · ${esc(label)}</p><h1>Overwatch tier list <em>${esc(label)}</em></h1><p>Every hero graded S to D from Blizzard's own pick and win rates in Competitive 5v5 Role Queue (PC · Americas). <a href="#/tier-list?rank=${esc(rank || '')}">Open the live tier list</a> to change platform, region or queue.</p></header>
      <nav class="chips rank-nav" aria-label="Tier list by rank"><a class="chip ${rank ? '' : 'on'}" href="tier-list/">All ranks</a>${RANKS.map(r => `<a class="chip ${r === rank ? 'on' : ''}" href="tier-list/${r}/">${cap(r)}</a>`).join('')}</nav>
      <section class="panel tier-panel"><div class="tiers">${groups.map(g => `<div class="tier-row t-${g.tier}"><div class="tier-badge"><b>${g.tier}</b><small>${esc(g.label)}</small></div><div class="tier-heroes">${g.heroes.map(tile).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>${updated(day)}</section>
      <section class="panel"><div class="prose"><h2>How this tier list is made</h2><p>${esc(METHOD)}</p></div></section>`,
  }), rank ? 0.7 : 0.9);
}
tierListPage('');
for (const r of RANKS) tierListPage(r);

// ---------- heroes ----------
for (const k of heroKeys) {
  const h = catalog.heroes[k];
  const cRow = comp?.rows.find(r => r.hero === k), qRow = qp?.rows.find(r => r.hero === k);
  const compTier = comp ? computeTiers(comp.rows, roleOf).find(r => r.hero === k)?.tier : null;
  const byRank = ranks ? RANKS.map(d => { const rows = ranks.divisions[d] || []; const r = rows.find(x => x.hero === k); return { d, r, tier: r ? computeTiers(rows, roleOf).find(x => x.hero === k)?.tier : null }; }) : [];
  const onMaps = mapStats ? Object.entries(mapStats.maps).map(([mk, rows]) => ({ mk, r: rows.find(x => x.hero === k) })).filter(x => x.r && x.r.pickrate >= 1) : [];
  const bestMaps = [...onMaps].sort((a, b) => b.r.winrate - a.r.winrate).slice(0, 5);
  const worstMaps = [...onMaps].sort((a, b) => a.r.winrate - b.r.winrate).slice(0, 3);
  const mapName = mk => rankedMaps.find(m => m.key === mk)?.name || mk;
  const art = media.heroArt[k];
  const hp = h.hitpoints || {};
  const desc = `${h.name} Overwatch stats: ${cRow ? `${pct(cRow.winrate)} win rate and ${pct(cRow.pickrate)} pick rate in Competitive Role Queue` : 'official hero rates'}${compTier ? `, ${compTier} tier` : ''}, win rate at every rank, best maps and abilities.`;
  add(`heroes/${k}/`, page({
    rel: '../../', canonical: `heroes/${k}/`, active: 'heroes',
    title: `${h.name} Overwatch Stats — Win Rate, Pick Rate & Tier by Rank | OverScope`,
    description: desc, image: art ? sized(art.url, 1200) : media.heroes[k]?.url, imageAlt: `${h.name} official artwork`,
    body: `<a class="back" href="heroes/">← All heroes</a>
      <section class="hero-detail-top static-hero role-${esc(h.role)}">${art ? `<div class="hd-art"><img class="hd-img" src="${esc(sized(art.url, 1600))}" srcset="${[800, 1600, 2400].map(w => `${esc(sized(art.url, w))} ${w}w`).join(', ')}" sizes="(max-width: 860px) 100vw, 75vw" width="${art.width}" height="${art.height}" alt="${esc(h.name)} official artwork" fetchpriority="high" decoding="async"></div><div class="hd-shade"></div>` : ''}
        <div class="hd-copy"><p class="eyebrow">${esc(ROLE[h.role])}${compTier ? ` · ${compTier} tier` : ''}</p><h1>${esc(h.name)}</h1><p class="lede">${esc(h.description)}</p>
        <dl class="facts">${h.location ? `<dt>Location</dt><dd>${esc(h.location)}</dd>` : ''}${h.age ? `<dt>Age</dt><dd>${esc(h.age)}</dd>` : ''}${hp.total ? `<dt>Hit points</dt><dd>${esc(hp.total)}</dd>` : ''}</dl>
        <div class="cta"><a class="btn primary" href="#/heroes/${esc(k)}">Live stats &amp; filters</a><a class="btn ghost" href="#/stadium/${esc(k)}">Stadium powers</a></div></div></section>
      <div class="two">
        <section class="panel"><header class="panel-head"><h2>${esc(h.name)} win rate by rank</h2></header>
          ${byRank.length ? `<table class="static-table"><thead><tr><th scope="col">Rank</th><th scope="col">Win rate</th><th scope="col">Pick rate</th><th scope="col">Tier</th></tr></thead><tbody>${byRank.map(x => `<tr><th scope="row"><a href="tier-list/${x.d}/">${cap(x.d)}</a></th><td>${pct(x.r?.winrate)}</td><td>${pct(x.r?.pickrate)}</td><td>${x.tier ? tierBadge(x.tier) : '—'}</td></tr>`).join('')}
          <tr class="sum"><th scope="row"><a href="tier-list/">All ranks</a></th><td>${pct(cRow?.winrate)}</td><td>${pct(cRow?.pickrate)}</td><td>${compTier ? tierBadge(compTier) : '—'}</td></tr></tbody></table>` : '<p class="muted pad">Rank tables are not available yet.</p>'}
          ${qRow ? `<p class="pad">Quick Play (all players): ${pct(qRow.winrate)} win rate · ${pct(qRow.pickrate)} pick rate.</p>` : ''}
          ${updated(ranks?.fetchedAt?.slice(0, 10) || comp?.day)}</section>
        <section class="panel"><header class="panel-head"><h2>Best maps for ${esc(h.name)}</h2></header>
          ${bestMaps.length ? `<table class="static-table"><thead><tr><th scope="col">Map</th><th scope="col">Win rate</th><th scope="col">Pick rate</th></tr></thead><tbody>${bestMaps.map(x => `<tr><th scope="row"><a href="maps/${esc(x.mk)}/">${esc(mapName(x.mk))}</a></th><td>${pct(x.r.winrate)}</td><td>${pct(x.r.pickrate)}</td></tr>`).join('')}</tbody></table>
          ${worstMaps.length ? `<p class="pad muted">Toughest maps: ${worstMaps.map(x => `<a href="maps/${esc(x.mk)}/">${esc(mapName(x.mk))}</a> (${pct(x.r.winrate)})`).join(', ')}.</p>` : ''}
          <p class="source-note">${esc(h.name)}'s win rate while playing on each map, all ranks, Competitive Role Queue · PC · Americas. Maps where ${esc(h.name)} is picked in under 1% of games are left out.</p>` : '<p class="muted pad">Map data is not available yet.</p>'}</section>
      </div>
      <section class="panel"><header class="panel-head"><h2>${esc(h.name)} abilities</h2></header><ul class="abilities">${h.abilities.map(a => `<li><div><b>${esc(a.name)}</b><p>${esc(a.description)}</p></div></li>`).join('')}</ul></section>`,
  }), 0.8);
}
add('heroes/', page({
  rel: '../', canonical: 'heroes/', active: 'heroes',
  title: 'All Overwatch Heroes — Stats, Win Rates & Tiers | OverScope',
  description: `Stats for all ${heroKeys.length} Overwatch heroes: official win rate, pick rate and tier at every rank, best maps and abilities.`,
  image: media.backgrounds?.home?.url || '',
  body: `<header class="page-top"><p class="eyebrow">Heroes</p><h1>All Overwatch <em>heroes</em></h1><p>Pick a hero for official win and pick rates at every rank, best maps and abilities. <a href="#/heroes">Open the interactive hero browser</a>.</p></header>
    ${['tank', 'damage', 'support'].map(role => `<section class="panel"><header class="panel-head"><h2>${ROLE[role]}</h2></header><div class="tier-heroes pad">${heroKeys.filter(k => catalog.heroes[k].role === role).map(heroLink).join('')}</div></section>`).join('')}`,
}), 0.8);

// ---------- maps ----------
for (const m of rankedMaps) {
  const rows = mapStats?.maps?.[m.key];
  const scored = rows ? computeTiers(rows, roleOf) : [];
  const best = scored.filter(r => r.tier === 'S' || r.tier === 'A');
  const img = media.maps[m.key];
  const modeKey = m.gamemodes.find(g => RANKED_MODES.includes(g));
  const mode = modes[modeKey];
  const roleBest = role => scored.filter(r => r.role === role).slice(0, 3);
  add(`maps/${m.key}/`, page({
    rel: '../../', canonical: `maps/${m.key}/`, active: 'maps',
    title: `Best Heroes for ${m.name} — Overwatch Map Stats | OverScope`,
    description: `${m.name}${m.location ? ` (${m.location})` : ''} — ${mode?.name || cap(modeKey)} map. ${best.length ? `Strongest heroes by Blizzard's official rates: ${best.slice(0, 6).map(r => nameOf(r.hero)).join(', ')}.` : 'Official map details.'}`,
    image: img?.url || '', imageAlt: `${m.name} map screenshot`,
    body: `<a class="back" href="maps/">← All maps</a>
      <header class="page-top"><p class="eyebrow">${esc(mode?.name || cap(modeKey))}${m.location ? ` · ${esc(m.location)}` : ''}</p><h1>${esc(m.name)}</h1>${mode?.scoring ? `<p>${esc(mode.scoring)}</p>` : ''}<p><a class="btn sm" href="#/maps">Interactive maps &amp; modes</a></p></header>
      ${img ? `<img class="static-map" src="${esc(img.url)}" width="${img.width}" height="${img.height}" alt="${esc(m.name)} map screenshot" fetchpriority="high" decoding="async">` : ''}
      ${scored.length ? `<div class="two"><section class="panel"><header class="panel-head"><h2>Best heroes on ${esc(m.name)}</h2></header>
          <table class="static-table"><thead><tr><th scope="col">Role</th><th scope="col">Top heroes on this map (win rate)</th></tr></thead><tbody>${['tank', 'damage', 'support'].map(role => `<tr><th scope="row">${ROLE[role]}</th><td>${roleBest(role).map(r => `<a href="heroes/${esc(r.hero)}/">${esc(nameOf(r.hero))}</a> ${tierBadge(r.tier)} ${pct(r.winrate)}`).join(' · ')}</td></tr>`).join('')}</tbody></table>
          ${updated(mapStats.fetchedAt.slice(0, 10))}</section>
        <section class="panel tier-panel"><header class="panel-head"><h2>${esc(m.name)} tier list</h2></header><div class="tiers">${groupTiers(scored).map(g => `<div class="tier-row t-${g.tier}"><div class="tier-badge"><b>${g.tier}</b></div><div class="tier-heroes">${g.heroes.map(r => `<a class="tier-hero text-only role-${esc(r.role)}" href="heroes/${esc(r.hero)}/"><span><b>${esc(nameOf(r.hero))}</b><small>${pct(r.winrate)} win</small></span></a>`).join('')}</div></div>`).join('')}</div>
          <p class="source-note">Same method as the <a href="tier-list/">main tier list</a>, using only games on ${esc(m.name)}.</p></section></div>`
        : '<section class="panel"><p class="pad muted">Blizzard does not publish hero rates for this map.</p></section>'}`,
  }), 0.6);
}
add('maps/', page({
  rel: '../', canonical: 'maps/', active: 'maps',
  title: 'Overwatch Maps — Best Heroes for Every Competitive Map | OverScope',
  description: `Every Overwatch competitive map with the strongest heroes on it, from Blizzard's official hero rates.`,
  image: media.maps['kings-row']?.url || '',
  body: `<header class="page-top"><p class="eyebrow">Maps</p><h1>Competitive <em>maps</em></h1><p>Pick a map to see which heroes win most on it.</p></header>
    ${RANKED_MODES.map(g => { const list = rankedMaps.filter(m => m.gamemodes.includes(g)); return list.length ? `<section class="panel"><header class="panel-head"><h2>${esc(modes[g]?.name || cap(g))}</h2></header><ul class="link-grid">${list.map(m => `<li><a href="maps/${esc(m.key)}/">${esc(m.name)}</a></li>`).join('')}</ul></section>` : ''; }).join('')}`,
}), 0.7);

// ---------- write everything ----------
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
for (const f of COPY) await fs.cp(path.join(ROOT, f), path.join(OUT, f), { recursive: true }).catch(e => { if (e.code !== 'ENOENT') throw e; });
// crawlable links from the app's own footer to the generated hubs
let idx = indexHtml.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]+)(">)/, (m, a, v, b) => a + withAds(v) + b).replace('</head>', `${adHead}\n</head>`).replace('<span>Overwatch, hero art', '<nav class="seo-links" aria-label="Browse"><a href="tier-list/">Tier list</a><a href="heroes/">All heroes</a><a href="maps/">All maps</a></nav><span>Overwatch, hero art');
if (SITE) idx = idx.replace('<link rel="icon"', `<link rel="canonical" href="${esc(SITE)}">\n  <meta property="og:url" content="${esc(SITE)}">\n  <meta property="og:type" content="website">\n  <meta property="og:title" content="OverScope — Overwatch Analytics">\n  <meta property="og:description" content="Official Overwatch hero rates by rank, tier lists, maps, Stadium builds and player profiles.">\n  ${media.backgrounds?.home?.url ? `<meta property="og:image" content="${esc(media.backgrounds.home.url)}">\n  <meta name="twitter:card" content="summary_large_image">\n  ` : ''}<link rel="icon"`);
await fs.writeFile(path.join(OUT, 'index.html'), idx);
for (const [rel, html] of pages) { await fs.mkdir(path.join(OUT, rel), { recursive: true }); await fs.writeFile(path.join(OUT, rel, 'index.html'), html); }
await fs.writeFile(path.join(OUT, '404.html'), page({ rel: SITE ? new URL(SITE).pathname : '/', title: 'Page not found | OverScope', description: 'This page does not exist.', body: `<div class="state empty"><b>Page not found</b><p>That address doesn't exist on OverScope. <a href="">Go to the home page</a>, the <a href="tier-list/">tier list</a> or <a href="heroes/">all heroes</a>.</p></div>` }));
const today = new Date().toISOString().slice(0, 10);
if (SITE) {
  await fs.writeFile(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${esc(SITE)}</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>\n${pages.map(([rel, , p]) => `<url><loc>${esc(SITE + rel)}</loc><lastmod>${today}</lastmod><priority>${p.toFixed(1)}</priority></url>`).join('\n')}\n</urlset>\n`);
  await fs.writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
} else {
  await fs.writeFile(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  console.log('· SITE_URL not set — sitemap.xml skipped, pages have no canonical links');
}
console.log(`✓ built _site/: ${pages.length} Google-visible pages + app${SITE ? ' + sitemap.xml' : ''} · patch impact ${measurable.length ? 'ON' : 'hidden (no before/after data yet)'} · tip link ${tipUrl ? 'ON' : 'off'} · ads ${ads.enabled ? 'ON (' + (ads.network || 'network') + ')' : 'off'}`);
