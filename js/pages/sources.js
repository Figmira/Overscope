import { $, esc, api, icon, getManifest, imageFailures, errorBox, loadingBox, timeAgo, sized } from '../lib.js';
import { OVERFAST } from '../data.js';

const ROWS = [
  ['Hero roster, roles, portraits', 'OverFast API /heroes (reads Blizzard\'s hero gallery)', 'All heroes', 'Live, cached 6 h in your browser', 'Blizzard-wide', 'Portraits load from Blizzard\'s image server'],
  ['Hero abilities, description, Stadium powers', 'OverFast /heroes/{key}', '—', 'Live, cached 6 h', 'Official text', 'Stadium items only for some heroes'],
  ['Competitive Role Queue hero pick / win / ban', 'Blizzard hero statistics via OverFast /heroes/stats?gamemode=competitive', 'PC / console · 3 regions · Bronze → Grandmaster', 'Live, cached 30 min', 'Blizzard-wide', 'No sample sizes or date windows are published'],
  ['Quick Play hero pick / win', 'Same endpoint, gamemode=quickplay', 'PC / console · 3 regions', 'Live, cached 30 min', 'Blizzard-wide', 'No rank filter'],
  ['Competitive Open Queue hero stats', 'None', '—', '—', '—', 'No verified public source. Shown as unavailable; never substituted'],
  ['Hero rates on a specific map', 'OverFast /heroes/stats?map={key}', 'Role Queue & Quick Play', 'Live', 'Blizzard-wide', 'Hero performance on that map — NOT how often the map is played'],
  ['Meta by rank', 'One official table per division', 'Role Queue', 'Live', 'Blizzard-wide', 'No Champion table is published'],
  ['Trend lines & patch impact', 'Daily copy of the official tables saved by the site\'s GitHub Action (data/history)', 'All ranks · per queue, platform, region', 'Daily', 'Blizzard-wide public averages', 'Starts from the first Action run; contains no user data'],
  ['News & patch notes', 'Blizzard news + patch-note pages, read by the GitHub Action (data/news.json)', 'Latest items', 'Every 3 h', 'Official', 'Browsers cannot read Blizzard\'s pages directly, so the Action copies the public list'],
  ['Player profiles, deep dive', 'OverFast /players…', 'Public profiles', 'Live, cached 5 min', 'Single player', 'Private profiles show little or nothing'],
  ['Your favorites, match log, viewed-profile history', 'This browser (localStorage)', 'This device', 'Instant', 'Personal — never leaves your device', 'Clearing browsing data removes it'],
  ['Maps, screenshots, modes', 'OverFast /maps and /gamemodes', 'All maps', 'Live, cached 6 h', 'Official', 'Two maps have no working screenshot upstream'],
];

export async function render({ main, signal }) {
  const m = getManifest();
  const count = o => Object.keys(o || {}).length;
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Methods · privacy · sources</p><h1>Every number <em>has a source</em></h1><p>OverScope has no server and no accounts. Your browser fetches public data directly; anything personal stays on your device.</p></header>
    <section class="panel"><header class="panel-head"><h2>${icon('i-info')}Data provenance</h2></header><div class="scroll-x"><table class="src-table"><thead><tr><th>Feature</th><th>Provider / endpoint</th><th>Coverage</th><th>Freshness</th><th>Scope</th><th>Limitations</th></tr></thead><tbody>${ROWS.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    <div class="two">
      <section class="panel" id="health">${loadingBox(3)}</section>
      <section class="panel"><header class="panel-head"><h2>${icon('i-mask')}Artwork check</h2></header><div class="prose">
        <p>Image list generated ${m.generatedAt ? esc(new Date(m.generatedAt).toLocaleString()) : '<b>not yet — the GitHub Action creates it</b>'}. Images load from Blizzard's and OverFast's servers; none are stored with the site.</p>
        <ul class="kv"><li><span>Hero portraits</span><b>${count(m.heroes)}</b></li><li><span>Large hero artwork</span><b>${count(m.heroArt)}</b></li><li><span>Transparent renders</span><b>${count(m.cutouts)}</b></li><li><span>Map screenshots</span><b>${count(m.maps)}</b></li></ul>
        <button class="btn sm primary" id="imgCheck">Load every image now and count failures</button><div id="imgOut" class="muted small"></div></div></section>
    </div>
    <section class="panel"><div class="prose"><h3>Privacy</h3>${document.querySelector('meta[name=overscope-ads]') ? '<p><b>This site shows ads.</b> The ad network may use cookies and see your visit; you can choose what you allow in the consent pop-up. OverScope itself still stores nothing about you on any server.</p>' : ''}<p>OverScope stores nothing about you. When you use the site, your browser contacts the OverFast API and Blizzard's image servers directly, so those services see your IP address and what you look up, like any website you visit. Favorites, logged matches and viewed-profile history are kept only in this browser.</p>
    <h3>Rights & affiliation</h3><p>OverScope is an unofficial fan project by <a href="https://figmira.com" target="_blank" rel="noopener">Figmira Labs</a>, not affiliated with or endorsed by Blizzard Entertainment. Overwatch, its heroes, artwork and map imagery are © Blizzard Entertainment. Statistics are relayed by the community-run <a href="https://overfast-api.tekrop.fr/docs" target="_blank" rel="noopener">OverFast API</a> (by TeKrop).</p></div></section></div>`;

  const checks = [];
  const t0 = performance.now();
  try { await fetch(`${OVERFAST}/heroes`, { signal: AbortSignal.timeout(15000) }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); }); checks.push(['OverFast API (live stats)', 'ok', `reachable from your browser in ${Math.round(performance.now() - t0)} ms`]); }
  catch (e) { checks.push(['OverFast API (live stats)', 'bad', e.message]); }
  try { const n = await api('/api/news', { fresh: true }); checks.push(['Blizzard news file', n.stale ? 'warn' : 'ok', `${n.patches.length} patch notes, ${n.news.length} news · updated ${timeAgo(n.checkedAt)}`]); }
  catch (e) { checks.push(['Blizzard news file', 'bad', e.message]); }
  try { const t = await api('/api/trend?queue=competitive&platform=pc&region=americas&days=365'); checks.push(['Public stat history', t.snapshots.length ? 'ok' : 'warn', t.snapshots.length ? `${t.snapshots.length} day(s) since ${t.days[0]}` : 'no days recorded yet']); }
  catch (e) { checks.push(['Public stat history', 'bad', e.message]); }
  $('#health').innerHTML = `<header class="panel-head"><h2>${icon('i-clock')}Live service health</h2></header><ul class="status-list">${checks.map(([n, st, d]) => `<li class="${st}"><b>${esc(n)}</b><small>${esc(d)}</small></li>`).join('')}</ul>`;

  $('#imgCheck').addEventListener('click', async () => {
    const urls = [...Object.values(m.heroes).map(x => x.url), ...Object.values(m.heroArt).map(x => sized(x, 800)), ...Object.values(m.cutouts).map(x => sized(x, 600)), ...Object.values(m.maps).map(x => x.url)];
    $('#imgOut').textContent = `Loading ${urls.length} images…`;
    const res = await Promise.all(urls.map(f => new Promise(ok => { const i = new Image(); i.onload = () => ok([f, i.naturalWidth > 0]); i.onerror = () => ok([f, false]); i.src = f; })));
    const bad = res.filter(r => !r[1]).map(r => r[0]);
    $('#imgOut').innerHTML = `<b>${res.length - bad.length} / ${res.length}</b> images loaded in this browser. ${bad.length ? 'Failed: ' + bad.map(esc).join(', ') : 'No failures.'} ${imageFailures.size ? `On-page failures this session: ${imageFailures.size}.` : ''}`;
  }, { signal });
}
