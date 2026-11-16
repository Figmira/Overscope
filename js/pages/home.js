import { favorites, relay, safeLink, seasonFromNews, INPUT_NAME, INPUT_SHORT, RANK_LABEL, RANK_SHORT } from '../lib.js';
import { $, $$, esc, pct, api, prefs, setPref, statsPath, qs, heroInfo, heroPortrait, heroArt, heroCutout, hasCutout, mapImage, getManifest, icon, roleIcon, badge, errorBox, loadingBox, emptyBox, fmtDate, timeAgo, ROLE_NAME, QUEUE_NAME, QUEUE_SHORT, REGION_NAME, sourceNote, openQueueUnavailable, toast } from '../lib.js';
import { heroes as loadHeroes, maps as loadMaps, news as loadNews, go } from '../app.js';
import { scatter, trend, legend, ring } from '../charts.js';

const CORE_MODES = ['control', 'escort', 'hybrid', 'push', 'flashpoint', 'clash'];
const scope = () => QUEUE_NAME[prefs.queue] + (prefs.queue === 'competitive' ? ' · ' + RANK_LABEL(prefs.division) : '');
const state = { role: '', mapKey: '', mapQueue: 'competitive', thumbStart: 0, chart: 'auto', chartRole: '' };

export async function render({ main, signal }) {
  const m = getManifest();
  const bg = m.backgrounds?.home || m.backgrounds?.news;
  $('#banner-slot').innerHTML = `
  <section class="banner" aria-label="OverScope introduction">
    <div class="banner-bg">${bg ? `<img src="${esc(relay(bg.url))}" alt="" class="os-img" data-fallback="Overwatch" decoding="async" fetchpriority="high">` : ''}</div>
    <div class="banner-shade"></div>
    <div class="banner-hero">${hasCutout('tracer') ? heroCutout('tracer', 'banner-cut', 1100) : heroArt('tracer', 'banner-art')}</div>
    <div class="banner-copy">
      <p class="eyebrow">Overwatch analytics</p>
      <h1>THE COMPLETE<br>OVERWATCH <em>INSIGHTS HUB</em></h1>
      <p>Player stats. Hero meta for Competitive Role Queue and Quick Play. Stadium powers. Maps and official patch notes. All in one place.</p>
      <div class="cta"><a class="btn primary" href="#/competitive">${icon('i-bars')}Explore meta${icon('i-arrow')}</a><a class="btn ghost" href="#/stadium">${icon('i-stadium')}View Stadium${icon('i-arrow')}</a></div>
    </div>
    <a class="patch-card" href="#/news?kind=patch" id="patchCard">
      <small id="patchSeason">Current season</small>
      <small>Latest patch</small><strong id="patchDate">Loading…</strong>
      <span class="live" id="patchLive">Official patch notes</span>
      <span class="more">Patch notes ${icon('i-arrow')}</span>
      <span class="patch-art">${heroArt('winston', 'patch-hero')}</span>
    </a>
  </section>`;

  main.innerHTML = `<div class="home">
    <div class="mode-row">
      <div class="mode-bar comp"><h2>${icon('i-laurel')}Hero meta</h2><div id="queueTabs"></div>
        <div class="mode-tools">
          <label class="sel"><span>Platform</span><select data-pref="platform"><option value="pc">PC</option><option value="console">Console</option></select></label>
          <label class="sel"><span>Region</span><select data-pref="region">${Object.entries(REGION_NAME).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div></div>
    </div>
    <div class="kpi-row">
      <section class="panel kpi" id="kpiComp">${loadingBox(2)}</section>
      <section class="panel kpi stadium-kpi" id="kpiStad">${loadingBox(2)}</section>
    </div>
    <div class="dash">
      <section class="panel meta" id="metaPanel">${loadingBox(5)}</section>
      <section class="panel mapcard" id="mapPanel">${loadingBox(5)}</section>
      <div class="stack">
        <section class="panel" id="chartPanel">${loadingBox(4)}</section>
        <section class="panel" id="hotPanel">${loadingBox(3)}</section>
      </div>
    </div>
    <div class="promo-row">
      <a class="promo compare" href="#/competitive?view=compare">
        <span class="promo-ic">${icon('i-laurel')}</span>
        <div><h3>Queue comparison</h3><p>Competitive vs Quick Play (both Role Queue) — the same heroes, side by side, each from its own dataset.</p></div>
        <span class="duo"><span class="duo-a">${hasCutout('tracer') ? heroCutout('tracer', 'duo-cut', 300) : heroPortrait('tracer', 'duo-img')}<b>Role Queue</b></span><i>VS</i><span class="duo-b">${hasCutout('zarya') ? heroCutout('zarya', 'duo-cut', 300) : heroPortrait('zarya', 'duo-img')}<b>Quick Play</b></span></span>
      </a>
      <a class="promo stadium" href="#/stadium"><span class="promo-ic">${icon('i-stadium')}</span><div><h3>Stadium insights</h3><p>Every hero's official Stadium powers. Pick 4, then share or export the build.</p></div><span class="promo-art">${heroCutout('junker-queen', 'promo-cut', 300)}</span>${icon('i-arrow', 'ic go')}</a>
      <section class="promo quick" aria-label="Quick player lookup">
        <span class="promo-ic">${icon('i-user')}</span>
        <form id="quickPlayer"><h3>Player lookup</h3><div class="inline"><input placeholder="BattleTag e.g. Name-1234" aria-label="BattleTag" required><button class="btn sm primary">Search</button></div><div id="quickOut" class="quick-out">${favorites().players.slice(0, 3).map(p => `<a class="qp" href="#/players/${encodeURIComponent(p.id)}">${p.avatar ? `<img src="${esc(relay(p.avatar))}" alt="" width="28" height="28">` : ''}<b>★ ${esc(p.name)}</b><small>favorite</small></a>`).join('')}</div></form>
      </section>
    </div>
    <div id="homeSource"></div>
  </div>`;

  $$('[data-pref]', main).forEach(s => { s.value = prefs[s.dataset.pref]; });
  main.addEventListener('change', e => {
    const p = e.target.dataset.pref; if (!p) return;
    setPref(p, e.target.value); loadStats();
  }, { signal });
  main.addEventListener('click', e => {
    const q = e.target.closest('[data-queue]');
    if (q) { setPref('queue', q.dataset.queue); state.mapQueue = q.dataset.queue; loadStats(); return; }
    const r = e.target.closest('[data-role]');
    if (r) { state.role = r.dataset.role; renderMeta(); return; }
    const mq = e.target.closest('[data-mapqueue]');
    if (mq) { state.mapQueue = mq.dataset.mapqueue; renderMap(); return; }
    const mk = e.target.closest('[data-mapkey]');
    if (mk) { state.mapKey = mk.dataset.mapkey; renderMap(); return; }
    const nav = e.target.closest('[data-thumbs]');
    if (nav) { state.thumbStart += Number(nav.dataset.thumbs); renderMap(); return; }
    const ch = e.target.closest('[data-chart]');
    if (ch) { state.chart = ch.dataset.chart; renderChart(); return; }
    const cr = e.target.closest('[data-chartrole]');
    if (cr) { state.chartRole = cr.dataset.chartrole; renderChart(); return; }
    const row = e.target.closest('[data-hero]');
    if (row) go('#/heroes/' + row.dataset.hero);
  }, { signal });
  main.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.hero-row')) { e.preventDefault(); go('#/heroes/' + e.target.dataset.hero); }
  }, { signal });
  $('#quickPlayer').addEventListener('submit', quickPlayer, { signal });

  state.mapQueue = prefs.queue;
  await loadHeroes().catch(() => {});
  loadStats();
  loadNewsPanels();
  loadStadium();
  loadMapsPanel();
}

let stats = null, statsErr = null, trendData = null;
async function loadStats() {
  $('#queueTabs').innerHTML = `<div class="seg big" role="tablist">${['competitive', 'quickplay'].map(q => `<button role="tab" class="${prefs.queue === q ? 'on' : ''}" aria-selected="${prefs.queue === q}" data-queue="${q}">${QUEUE_SHORT[q]}</button>`).join('')}</div>`;
  $('#metaPanel').innerHTML = metaHead() + loadingBox(5);
  $('#kpiComp').innerHTML = loadingBox(2);
  stats = null; statsErr = null; trendData = null;
  try {
    stats = await api(statsPath());
    if (stats.available) {
      trendData = await api('/api/trend?' + qs({ queue: prefs.queue, platform: prefs.platform, region: prefs.region, division: prefs.division || 'all', role: 'all', map: 'all' }), { fresh: true }).catch(() => null);
    }
  } catch (e) { statsErr = e; }
  renderMeta(); renderKpi(); renderChart(); renderMap();
  $('#homeSource').innerHTML = stats?.available ? sourceNote(stats) : '';
}

function metaHead() {
  return `<header class="panel-head"><h2>${icon('i-laurel')}Hero meta<small>— ${esc(scope())}</small></h2>${roleTabs()}</header>`;
}
function roleTabs() {
  return `<div class="chips">${[['', 'All roles'], ['tank', 'Tank'], ['damage', 'Damage'], ['support', 'Support']].map(([k, v]) => `<button class="chip ${state.role === k ? 'on' : ''}" aria-pressed="${state.role === k}" data-role="${k}">${v}</button>`).join('')}</div>`;
}

function trendDelta(hero) {
  const s = trendData?.snapshots;
  if (!s || s.length < 3) return null;
  const a = s[0].rows.find(r => r.hero === hero)?.pickrate, b = s[s.length - 1].rows.find(r => r.hero === hero)?.pickrate;
  return a == null || b == null ? null : b - a;
}

function renderMeta() {
  const el = $('#metaPanel');
  if (statsErr) { el.innerHTML = metaHead() + errorBox(statsErr); return; }
  if (!stats) return;
  if (!stats.available) { el.innerHTML = metaHead() + openQueueUnavailable(stats.reason); return; }
  const rows = stats.rows.filter(r => !state.role || heroInfo(r.hero).role === state.role).sort((a, b) => b.pickrate - a.pickrate).slice(0, 8);
  const maxPick = Math.max(...stats.rows.map(r => r.pickrate), 1);
  const bar = (v, max, cls) => `<span class="meter ${cls}"><i style="width:${Math.max(2, Math.min(100, (v / max) * 100))}%"></i></span>`;
  const hasTrend = (trendData?.snapshots?.length || 0) >= 3;
  el.innerHTML = metaHead() + `<div class="table meta-table ${hasTrend ? '' : 'no-trend'} ${stats.hasBanRate ? '' : 'no-ban'}" role="table" aria-label="Top heroes by pick rate">
    <div class="tr th" role="row"><span>#</span><span>Hero</span><span>Pick rate</span><span>Win rate</span>${stats.hasBanRate ? '<span>Ban rate</span>' : ''}${hasTrend ? `<span title="Change in pick rate since ${hasTrend ? esc(fmtDate(trendData.days[0])) : 'the first saved day'}">Since ${esc(fmtDate(trendData.days[0]).replace(/, \d{4}$/, ''))}</span>` : ''}</div>
    ${rows.map((r, i) => {
      const h = heroInfo(r.hero); const d = trendDelta(r.hero);
      return `<div class="tr hero-row" role="row" tabindex="0" data-hero="${esc(r.hero)}" aria-label="${esc(h.name)}: pick ${pct(r.pickrate)}, win ${pct(r.winrate)}">
        <span class="rank">${i + 1}</span>
        <span class="who">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(h.name)}</b><small>${roleIcon(h.role)}${esc(ROLE_NAME[h.role] || '')}</small></span></span>
        <span class="num"><b>${pct(r.pickrate)}</b>${bar(r.pickrate, maxPick, 'cyan')}</span>
        <span class="num"><b>${pct(r.winrate)}</b>${bar(r.winrate - 40, 20, 'green')}</span>
        ${stats.hasBanRate ? `<span class="num">${r.banrate != null ? `<b>${pct(r.banrate)}</b>${bar(r.banrate, 30, 'pink')}` : '<span class="na" title="No ban rate for this hero in the official table">—</span>'}</span>` : ''}
        ${hasTrend ? `<span class="trend-cell">${d == null ? '<span class="na" title="Not in the earliest saved day">—</span>' : d > 0.05 ? `<span class="up">▲ ${d.toFixed(1)}</span>` : d < -0.05 ? `<span class="down">▼ ${Math.abs(d).toFixed(1)}</span>` : '<span class="flat">＝</span>'}</span>` : ''}
      </div>`;
    }).join('')}
  </div><footer class="panel-foot"><span class="muted">${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])}${prefs.queue === 'competitive' && prefs.division ? ' · ' + esc(RANK_LABEL(prefs.division)) : ''} · official Blizzard rates</span><a href="#/competitive?queue=${prefs.queue}">View full hero meta ${icon('i-arrow')}</a></footer>`;
}

function renderKpi() {
  const el = $('#kpiComp');
  const head = `<div class="kpi-emblem">${icon('i-laurel')}</div><div class="kpi-title"><h2>Overview <small>— ${esc(scope())}</small></h2><p>${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])}${stats?.source ? ' · updated ' + esc(timeAgo(stats.source.fetchedAt)) : ''}</p></div>`;
  if (statsErr) { el.innerHTML = `<div class="kpi-in">${head}<p class="kpi-msg">Live statistics are unavailable: ${esc(statsErr.message)}</p></div>`; return; }
  if (!stats) return;
  if (!stats.available) { el.innerHTML = `<div class="kpi-in">${head}<p class="kpi-msg">No verified Open Queue dataset exists. Nothing is shown rather than borrowing Role Queue numbers.</p></div>`; return; }
  const rows = stats.rows;
  const top = [...rows].sort((a, b) => b.pickrate - a.pickrate)[0];
  const best = [...rows].filter(r => r.pickrate >= 1).sort((a, b) => b.winrate - a.winrate)[0] || top;
  const banned = stats.hasBanRate ? [...rows].sort((a, b) => (b.banrate ?? -1) - (a.banrate ?? -1))[0] : null;
  const above = rows.filter(r => r.winrate > 50).length;
  const worst = [...rows].sort((a, b) => a.winrate - b.winrate)[0];
  const g = (label, val, max, color, who, shown = pct(val)) => `<div class="gauge">${ring(val, max, color)}<div><small>${label}</small><b>${shown}</b><em>${who}</em></div></div>`;
  const lead = `<div class="kpi-lead">${heroPortrait(top.hero, 'kpi-portrait')}<div><small>Most picked</small><b>${esc(heroInfo(top.hero).name)}</b><em>${pct(top.pickrate)} pick rate</em></div></div>`;
  el.innerHTML = `<div class="kpi-in">${head.replace('</p></div>', '</p>' + lead + '</div>')}
    <div class="gauges">
      ${g('Top win rate', best.winrate, 100, '#69dca9', esc(heroInfo(best.hero).name) + (best.pickrate < 2 ? ' · low pick' : ''))}
      ${banned ? g('Top ban rate', banned.banrate, 100, '#fa68ae', esc(heroInfo(banned.hero).name)) : g('Above 50% win', above, rows.length, '#fa68ae', `${above} of ${rows.length} heroes`, `${above}/${rows.length}`)}
      ${g('Lowest win rate', worst.winrate, 100, '#56d9fb', esc(heroInfo(worst.hero).name) + (worst.pickrate < 2 ? ' · low pick' : ''))}
    </div></div>`;
}

function renderChart() {
  const el = $('#chartPanel');
  const days = trendData?.snapshots?.length || 0;
  const mode = state.chart === 'auto' ? (days >= 3 ? 'trend' : 'snapshot') : state.chart;
  const tabs = `<div class="chips tiny"><button class="chip ${mode === 'snapshot' ? 'on' : ''}" data-chart="snapshot">Snapshot</button><button class="chip ${mode === 'trend' ? 'on' : ''}" data-chart="trend">Trend</button></div>`;
  const head = t => `<header class="panel-head"><h2>${icon('i-chart')}${t}</h2>${tabs}</header>`;
  if (statsErr) { el.innerHTML = head('Meta trend') + errorBox(statsErr); return; }
  if (!stats) return;
  if (!stats.available) { el.innerHTML = head('Meta trend') + `<div class="state unavailable small"><b>No Open Queue data</b><p>Charts need a verified dataset.</p></div>`; return; }
  if (mode === 'trend') {
    if (days < 3) {
      el.innerHTML = head('Meta trend') + `<div class="state empty small"><b>Collecting daily snapshots</b><p>${days ? `First snapshot stored ${esc(fmtDate(trendData.days[0]))}.` : 'A snapshot is stored the first time each day the stats load.'} The trend line appears from the second day — no history is invented.</p></div>`;
      return;
    }
    const top = [...stats.rows].sort((a, b) => b.pickrate - a.pickrate).slice(0, 3).map(r => r.hero);
    el.innerHTML = head(`Meta trend <small>— pick rate on ${days} saved days since ${esc(fmtDate(trendData.days[0]))}</small>`) + `<div class="chart-wrap">${trend(trendData.snapshots, top)}</div>`;
    return;
  }
  const roleChips = `<div class="chips tiny chart-roles">${[['', 'All roles'], ['tank', 'Tank'], ['damage', 'Damage'], ['support', 'Support']].map(([k, v]) => `<button class="chip ${state.chartRole === k ? 'on' : ''}" data-chartrole="${k}">${k ? roleIcon(k) : ''}${v}</button>`).join('')}</div>`;
  const shown = state.chartRole ? stats.rows.filter(r => heroInfo(r.hero).role === state.chartRole) : stats.rows;
  el.innerHTML = head('Meta snapshot <small>— pick vs win</small>') + roleChips + `<div class="chart-wrap">${scatter(shown, { highlight: [...shown].sort((a, b) => b.pickrate - a.pickrate).slice(0, state.chartRole ? 3 : 0).map(r => r.hero) })}${state.chartRole ? '' : legend({ rings: true })}</div>`;
}

async function loadNewsPanels() {
  const hot = $('#hotPanel');
  const head = `<header class="panel-head"><h2>${icon('i-flame')}What's hot</h2><a class="link-sm" href="#/news">All news ${icon('i-arrow')}</a></header>`;
  try {
    const n = await loadNews();
    const latestPatch = n.patches[0];
    $('#patchDate').textContent = latestPatch ? fmtDate(latestPatch.date) : 'Patch notes';
    const ago = latestPatch ? Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(latestPatch.date)) / 86400_000) : null;
    $('#patchLive').textContent = latestPatch ? (n.stale ? 'Last saved copy' : `Released ${ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago'}`) : 'Official archive';
    const season = seasonFromNews(n.news);
    $('#patchSeason').textContent = season ? `${season.arc ? season.arc + ' · ' : ''}Season ${season.number}${season.name ? ': ' + season.name : ''}` : 'Current season';
    $('#patchSeason').classList.toggle('season-on', !!season);
    $('#patchLive').classList.toggle('stale', !latestPatch || n.stale);
    if (latestPatch) $('#patchCard').href = '#/news?kind=patch';
    const items = [...n.news.slice(0, 2), ...(latestPatch ? [latestPatch] : [])].slice(0, 3);
    if (!items.length) { hot.innerHTML = head + emptyBox('No headlines right now', 'Blizzard\'s news pages could not be read. ' + esc(n.errors?.[0] || ''), '<a class="btn sm" href="https://overwatch.blizzard.com/en-us/news/" target="_blank" rel="noopener">Open Blizzard news</a>'); return; }
    hot.innerHTML = head + `<ul class="hot">${items.map(it => `<li><a href="${esc(safeLink(it.url))}" target="_blank" rel="noopener">
      <span class="thumb">${relay(it.image) ? `<img src="${esc(relay(it.image))}" alt="" loading="lazy" class="os-img" data-fallback="${it.kind === 'patch' ? 'PATCH' : 'NEWS'}" data-role="news">` : `<span class="img-fallback role-news">${it.kind === 'patch' ? 'PATCH' : 'NEWS'}</span>`}</span>
      <span><b>${esc(it.title)}</b><small>${it.kind === 'patch' ? 'Patch notes' : 'Blizzard news'}${it.date ? ' · ' + esc(fmtDate(it.date)) : ''}</small></span>${icon('i-right')}</a></li>`).join('')}</ul>`;
  } catch (e) {
    $('#patchDate').textContent = 'Patch notes';
    $('#patchLive').textContent = 'Feed unavailable'; $('#patchLive').classList.add('stale');
    hot.innerHTML = head + errorBox(e);
  }
}

async function loadStadium() {
  const el = $('#kpiStad');
  const head = `<div class="kpi-emblem stad">${icon('i-stadium')}</div><div class="kpi-title"><h2>Stadium overview</h2><p>Official hero powers · build lab</p></div>`;
  let count = null, featured = null, powers = null;
  try { const s = await api('/api/heroes?gamemode=stadium', { ttl: 3600_000 }); if (s.data) { count = s.data.length; featured = s.data.find(h => h.key === 'tracer')?.key || s.data[0]?.key; } } catch { /* optional */ }
  featured = featured || 'tracer';
  try { const d = await api('/api/heroes/' + featured, { ttl: 3600_000 }); powers = d.data.stadium; } catch { /* optional */ }
  const h = heroInfo(featured);
  const lead = `<div class="kpi-lead small">${heroPortrait(featured, 'kpi-portrait')}<div><small>Featured hero</small><b>${esc(h.name)}</b><em>Stadium powers</em></div></div>`;
  el.innerHTML = `<div class="kpi-in">${head.replace('</p></div>', '</p>' + lead + '</div>')}
    <div class="kpi-stat"><small>Stadium heroes</small><b>${count ?? '—'}</b><em>${count ? 'eligible roster' : 'roster filter unavailable'}</em></div>
    <div class="kpi-stat"><small>${esc(h.name)} powers</small><b>${powers?.powers?.length || '—'}</b><em>official powers</em></div>
    <a class="btn sm purple" href="#/stadium/${esc(featured)}">Open lab ${icon('i-arrow')}</a></div>`;
}

let mapData = null, mapErr = null;
async function loadMapsPanel() {
  try { mapData = await loadMaps(); } catch (e) { mapErr = e; }
  renderMap();
}
const FEATURED = ['circuit-royal', 'kings-row', 'ilios', 'watchpoint-gibraltar', 'shambali-monastery', 'lijiang-tower', 'new-queen-street', 'suravasa'];
function competitiveMaps() {
  const list = (mapData?.data || []).filter(m => m.gamemodes.some(g => CORE_MODES.includes(g)));
  const rank = k => { const i = FEATURED.indexOf(k); return i < 0 ? 99 : i; };
  return list.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}
let mapStatsCache = new Map();
async function renderMap() {
  const el = $('#mapPanel');
  if (!el) return;
  const head = `<header class="panel-head"><h2>${icon('i-map')}Map intelligence</h2><div class="seg sm">${['competitive', 'quickplay'].map(q => `<button class="${state.mapQueue === q ? 'on' : ''}" data-mapqueue="${q}">${QUEUE_SHORT[q]}</button>`).join('')}</div></header>`;
  if (mapErr) { el.innerHTML = head + errorBox(mapErr); return; }
  if (!mapData) return;
  const list = competitiveMaps();
  if (!list.length) { el.innerHTML = head + emptyBox('No maps', 'The map list is empty.'); return; }
  if (!state.mapKey || !list.some(m => m.key === state.mapKey)) {
    const withArt = list.filter(m => getManifest().maps[m.key]);
    state.mapKey = (withArt.find(m => m.key === 'circuit-royal') || withArt[0] || list[0]).key;
  }
  const m = list.find(x => x.key === state.mapKey);
  const mode = m.gamemodes.find(g => CORE_MODES.includes(g)) || m.gamemodes[0];
  const modeName = mapData.mechanics?.[mode]?.name || mode;
  const n = 5; const start = ((state.thumbStart % list.length) + list.length) % list.length;
  const thumbs = Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(start + i) % list.length]);
  el.innerHTML = head + `<div class="map-feature">
    <a class="map-hero" href="#/maps/${esc(m.key)}">${mapImage(m.key, m.name, 'map-big', false)}<span class="map-label"><b>${esc(m.name)}</b><small>${esc(modeName)} · ${esc(m.location)}</small></span></a>
    <div class="map-facts" id="mapFacts">${loadingBox(3)}</div>
  </div>
  <div class="thumbs"><button class="arrow" data-thumbs="-1" aria-label="Previous maps">${icon('i-left')}</button>
    ${thumbs.map(t => `<button class="thumb ${t.key === m.key ? 'on' : ''}" data-mapkey="${esc(t.key)}" aria-pressed="${t.key === m.key}">${mapImage(t.key, t.name, 'thumb-img')}<b>${esc(t.name)}</b></button>`).join('')}
    <button class="arrow" data-thumbs="1" aria-label="Next maps">${icon('i-right')}</button></div>
  ${mapData.mechanics?.[mode] ? `<div class="obj-strip"><span class="obj-title">${icon('i-info')}${esc(modeName)} objective</span>${mapData.mechanics[mode].phases.map((p, i) => `<span><b>${String(i + 1).padStart(2, '0')}</b>${esc(p)}</span>`).join('')}</div>` : ''}
  <p class="fine">Hero rates <b>on</b> a map are not the same as how often the map is played. Blizzard does not publish map appearance rates. <a href="#/maps">Maps & modes ${icon('i-arrow')}</a></p>`;

  const facts = $('#mapFacts');
  const key = state.mapQueue + ':' + m.key + ':' + prefs.platform + prefs.region;
  try {
    let s = mapStatsCache.get(key);
    if (!s) { s = await api(statsPath({ queue: state.mapQueue, map: m.key, division: '' })); mapStatsCache.set(key, s); }
    if (state.mapKey !== m.key) return;
    const rows = [...s.rows].sort((a, b) => b.pickrate - a.pickrate);
    if (!rows.length) { facts.innerHTML = `<dl><dt>Mode</dt><dd>${esc(modeName)}</dd></dl>` + emptyBox('No map data', `No hero rates are published for ${esc(m.name)} with these filters.`); return; }
    const best = [...rows].filter(r => r.pickrate >= 1).sort((a, b) => b.winrate - a.winrate)[0] || rows[0];
    facts.innerHTML = `<dl>
      <dt>Mode</dt><dd>${esc(modeName)}</dd>
      <dt>Most-picked hero here</dt><dd class="hero-dd">${heroPortrait(rows[0].hero, 'mini')}${esc(heroInfo(rows[0].hero).name)} <b>${pct(rows[0].pickrate)}</b></dd>
      <dt>Best win rate here</dt><dd class="hero-dd">${heroPortrait(best.hero, 'mini')}${esc(heroInfo(best.hero).name)} <b>${pct(best.winrate)}</b></dd>
    </dl><small class="muted">${esc(QUEUE_SHORT[state.mapQueue])} · ${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])} · all ranks</small>`;
  } catch (e) {
    facts.innerHTML = `<dl><dt>Mode</dt><dd>${esc(modeName)}</dd></dl><p class="muted small">Map-specific hero rates unavailable: ${esc(e.message)}</p>`;
  }
}

async function quickPlayer(e) {
  e.preventDefault();
  const v = e.target.querySelector('input').value.trim();
  const out = $('#quickOut');
  out.innerHTML = '<span class="muted">Searching…</span>';
  try {
    const r = await api('/api/players?' + qs({ name: v.replace('#', '-') }));
    if (!r.results.length) { out.innerHTML = '<span class="muted">No public player found with that name.</span>'; return; }
    out.innerHTML = r.results.slice(0, 3).map(p => `<a class="qp" href="#/players/${encodeURIComponent(p.id)}">${p.avatar ? `<img src="${esc(relay(p.avatar))}" alt="" width="28" height="28">` : ''}<b>${esc(p.name)}</b><small>${esc(p.id)}</small></a>`).join('') + (r.results.length > 3 ? `<a class="link-sm" href="#/players?q=${encodeURIComponent(v)}">${r.results.length - 3} more…</a>` : '');
  } catch (err) { out.innerHTML = `<span class="err">${esc(err.message)}</span>`; }
}
