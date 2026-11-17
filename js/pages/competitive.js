import { $, esc, pct, api, prefs, setPref, statsPath, qs, heroInfo, heroPortrait, icon, roleIcon, roleTabs, errorBox, loadingBox, emptyBox, ROLE_NAME, QUEUE_NAME, QUEUE_SHORT, REGION_NAME, queueTabs, filterSelects, sourceNote, openQueueUnavailable, DIVISIONS, cap, fmtDate, timeAgo, safeLink , INPUT_NAME, INPUT_SHORT, RANK_LABEL, RANK_SHORT } from '../lib.js';
import { news as loadNews } from '../app.js';
import { heroes as loadHeroes, go } from '../app.js';
import { scatter, legend } from '../charts.js';
import { computeTiers } from '../tiers.js';

const ui = { role: '', sort: 'pickrate', dir: -1, metric: 'pickrate', patchQueue: 'competitive', climbRank: '', patchRank: 'all' };

export async function render({ main, route, signal }) {
  const q = route.query.get('queue');
  if (['competitive', 'quickplay'].includes(q)) setPref('queue', q);
  const patchOff = !!document.querySelector('meta[name=overscope-patch-impact][content=off]');
  const views = [['table', 'Rankings'], ['climb', 'Climb guide'], ['compare', 'Competitive vs Quick Play'], ['ranks', 'Meta by rank'], ...(patchOff ? [] : [['patch', 'Patch winners & losers']])];
  const view = views.some(([k]) => k !== 'table' && k === route.query.get('view')) ? route.query.get('view') : 'table';
  const draw = () => (view === 'climb' ? drawClimb() : view === 'compare' ? drawCompare() : view === 'ranks' ? drawRanks() : view === 'patch' ? drawPatch(route.query.get('date')) : drawTable());
  await loadHeroes().catch(() => {});
  main.innerHTML = `<div class="page">
    ${view === 'table' && prefs.queue === 'quickplay'
      ? `<header class="page-top"><p class="eyebrow">Quick Play · Role Queue</p><h1>Quick Play <em>hero meta</em></h1><p>Blizzard's official hero pick and win rates for Quick Play (Role Queue), covering games since the start of the current patch. Blizzard publishes no ban rates or rank split for Quick Play.</p></header>`
      : view === 'table'
        ? `<header class="page-top"><p class="eyebrow">Competitive · Role Queue</p><h1>Competitive <em>hero meta</em></h1><p>Blizzard's official hero pick, win and ban rates for Competitive Role Queue, covering games since the start of the current patch. Blizzard publishes no Open Queue hero rates.</p></header>`
        : `<header class="page-top"><p class="eyebrow">Hero meta · Role Queue</p><h1>Meta <em>analysis</em></h1><p>Blizzard's official hero rates for Role Queue (Competitive and Quick Play), covering games since the start of the current patch. Each queue is its own dataset.</p></header>`}
    <div class="toolbar"><div class="seg big" role="tablist">${views.map(([k, v]) => `<button class="${view === k ? 'on' : ''}" data-view="${k}">${v}</button>`).join('')}</div></div>
    <div id="compBody"></div></div>`;
  main.addEventListener('click', e => {
    const v = e.target.closest('[data-view]'); if (v) return go(v.dataset.view === 'table' ? '#/competitive?queue=' + prefs.queue : '#/competitive?view=' + v.dataset.view);
    const m = e.target.closest('[data-metric]'); if (m) { ui.metric = m.dataset.metric; return draw(); }
    const qb = e.target.closest('[data-queue]'); if (qb) return go('#/competitive?queue=' + qb.dataset.queue);
    const r = e.target.closest('[data-role]'); if (r) { ui.role = r.dataset.role; return draw(); }
    const s = e.target.closest('[data-sort]'); if (s) { if (ui.sort === s.dataset.sort) ui.dir *= -1; else { ui.sort = s.dataset.sort; ui.dir = s.dataset.sort === 'hero' ? 1 : -1; } return drawTable(); }
    const h = e.target.closest('[data-hero]'); if (h) go('#/heroes/' + h.dataset.hero);
  }, { signal });
  main.addEventListener('change', e => {
    const p = e.target.dataset.pref; if (p) { setPref(p, e.target.value); return draw(); }
    if (e.target.id === 'patchSel') return go('#/competitive?view=patch&date=' + e.target.value);
    if (e.target.id === 'patchQueue') { ui.patchQueue = e.target.value; return draw(); }
    if (e.target.id === 'climbRank') { ui.climbRank = e.target.value; return draw(); }
    if (e.target.id === 'patchRank') { ui.patchRank = e.target.value; return draw(); }
  }, { signal });
  main.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.hero) go('#/heroes/' + e.target.dataset.hero); }, { signal });
  draw();
}

async function drawTable() {
  const body = $('#compBody');
  body.innerHTML = `<div class="toolbar">${queueTabs(prefs.queue)}${filterSelects()}</div>
    <div class="toolbar">${roleTabs(ui.role)}</div>
    <div class="two wide-left"><section class="panel" id="rankPanel">${loadingBox(8)}</section>
    <div class="col"><section class="panel" id="scatterPanel"></section><section class="panel">${explain()}</section></div></div>`;
  let s;
  try { s = await api(statsPath()); } catch (e) { $('#rankPanel').innerHTML = errorBox(e); $('#scatterPanel').innerHTML = ''; return; }
  if (!s.available) { $('#rankPanel').innerHTML = openQueueUnavailable(s.reason); $('#scatterPanel').innerHTML = ''; return; }
  const rows = s.rows.filter(r => !ui.role || heroInfo(r.hero).role === ui.role);
  const val = r => ui.sort === 'hero' ? heroInfo(r.hero).name : (r[ui.sort] ?? -1);
  rows.sort((a, b) => { const A = val(a), B = val(b); return (A > B ? 1 : A < B ? -1 : 0) * ui.dir; });
  const maxPick = Math.max(...s.rows.map(r => r.pickrate), 1);
  const th = (k, label) => `<button class="sort ${ui.sort === k ? 'on' : ''}" data-sort="${k}" aria-label="Sort by ${label}">${label}${ui.sort === k ? (ui.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`;
  $('#rankPanel').innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Hero rankings<small>— ${esc(QUEUE_NAME[prefs.queue])}</small></h2><span class="badge live">${s.source.stale ? 'SAVED COPY' : 'LIVE'}</span></header>
    <div class="table rank-table${s.hasBanRate ? '' : ' no-ban'}" role="table"><div class="tr th" role="row"><span>#</span>${th('hero', 'Hero')}${th('pickrate', 'Pick rate')}${th('winrate', 'Win rate')}${s.hasBanRate ? th('banrate', 'Ban rate') : ''}</div>
    ${rows.map((r, i) => { const h = heroInfo(r.hero); return `<div class="tr hero-row" role="row" tabindex="0" data-hero="${esc(r.hero)}"><span class="rank">${i + 1}</span><span class="who">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(h.name)}</b><small>${roleIcon(h.role)}${esc(ROLE_NAME[h.role] || '')}</small></span></span>
      <span class="num"><b>${pct(r.pickrate)}</b><span class="meter cyan"><i style="width:${(r.pickrate / maxPick) * 100}%"></i></span></span>
      <span class="num"><b class="${r.winrate >= 52 ? 'good' : r.winrate <= 48 ? 'bad' : ''}">${pct(r.winrate)}</b><span class="meter green"><i style="width:${Math.max(2, Math.min(100, (r.winrate - 40) * 5))}%"></i></span></span>
      ${s.hasBanRate ? `<span class="num">${r.banrate != null ? `<b>${pct(r.banrate)}</b><span class="meter pink"><i style="width:${Math.min(100, r.banrate * 3)}%"></i></span>` : '—'}</span>` : ''}</div>`; }).join('')}</div>
    ${sourceNote(s)}`;
  $('#scatterPanel').innerHTML = `<header class="panel-head"><h2>${icon('i-chart')}Pick vs win</h2></header><div class="chart-wrap">${scatter(rows.length ? rows : s.rows, { height: 240 })}${legend({ rings: true })}</div>`;
}

function explain() {
  return `<div class="prose"><h3>What these numbers mean</h3>
  <p><b>Pick rate</b> — Blizzard's measure of how much a hero is played: that hero's share of total playtime across all heroes, for this queue, input, region and rank.</p>
  <p><b>Win rate</b> — share of games won while playing the hero (Blizzard's unmirrored win rate).</p>
  <p><b>Ban rate</b> — shown only when the official table includes it.</p>
  <p><b>Not the same as map popularity.</b> How often a <i>map</i> is played is a different metric that Blizzard does not publish. See <a href="#/maps">Maps</a>.</p>
  <p class="muted">Blizzard's numbers cover games since the start of the current patch (it can take up to a day to refresh after a patch). Blizzard does not publish game counts; OverScope shows when each copy was fetched.</p></div>`;
}

async function drawCompare() {
  const body = $('#compBody');
  body.innerHTML = `<div class="toolbar">${filterSelects({ showRank: false })}${roleTabs(ui.role)}</div><section class="panel" id="cmp">${loadingBox(8)}</section>`;
  try {
    const [a, b] = await Promise.all([api(statsPath({ queue: 'competitive', division: '' })), api(statsPath({ queue: 'quickplay', division: '' }))]);
    const keys = [...new Set([...a.rows, ...b.rows].map(r => r.hero))].filter(k => !ui.role || heroInfo(k).role === ui.role);
    const A = new Map(a.rows.map(r => [r.hero, r])), B = new Map(b.rows.map(r => [r.hero, r]));
    keys.sort((x, y) => (A.get(y)?.pickrate ?? 0) - (A.get(x)?.pickrate ?? 0));
    const diff = (x, y) => (x == null || y == null) ? '' : `<span class="${y - x > 0.05 ? 'up' : y - x < -0.05 ? 'down' : 'flat'}">${y - x > 0 ? '+' : ''}${(y - x).toFixed(1)}</span>`;
    $('#cmp').innerHTML = `<header class="panel-head"><h2>${icon('i-bars')}Competitive vs Quick Play</h2><small class="muted">${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])} · all ranks</small></header>
    <div class="table cmp-table" role="table"><div class="tr th"><span>Hero</span><span>Comp pick</span><span>QP pick</span><span>Δ pick</span><span>Comp win</span><span>QP win</span><span>Δ win</span></div>
    ${keys.map(k => { const x = A.get(k), y = B.get(k), h = heroInfo(k); return `<div class="tr hero-row" tabindex="0" data-hero="${esc(k)}"><span class="who">${heroPortrait(k, 'portrait')}<span><b>${esc(h.name)}</b><small>${roleIcon(h.role)}${esc(ROLE_NAME[h.role] || '')}</small></span></span><span>${pct(x?.pickrate)}</span><span>${pct(y?.pickrate)}</span><span>${diff(x?.pickrate, y?.pickrate)}</span><span>${pct(x?.winrate)}</span><span>${pct(y?.winrate)}</span><span>${diff(x?.winrate, y?.winrate)}</span></div>`; }).join('')}</div>
    <p class="source-note">Two separate official datasets (gamemode=competitive and gamemode=quickplay) fetched independently. Δ = Quick Play minus Competitive, in percentage points. Both are Role Queue.</p>`;
  } catch (e) { $('#cmp').innerHTML = errorBox(e); }
}

// ---------- Meta by rank: one official table per division, as a heatmap ----------
async function drawRanks() {
  const body = $('#compBody');
  body.innerHTML = `<div class="toolbar">${filterSelects({ showRank: false })}<div class="seg">${[['pickrate', 'Pick rate'], ['winrate', 'Win rate'], ['banrate', 'Ban rate']].map(([k, v]) => `<button class="${ui.metric === k ? 'on' : ''}" data-metric="${k}">${v}</button>`).join('')}</div></div><div class="toolbar">${roleTabs(ui.role)}</div><section class="panel" id="rankHeat">${loadingBox(10)}</section>`;
  let d;
  try { d = await api('/api/stats/by-rank?' + qs({ platform: prefs.platform, region: prefs.region }), { ttl: 30 * 60_000 }); }
  catch (e) { $('#rankHeat').innerHTML = errorBox(e); return; }
  const divs = DIVISIONS.filter(x => d.divisions[x]?.length);
  if (!divs.length) { $('#rankHeat').innerHTML = errorBox(Object.values(d.errors)[0] || 'No data'); return; }
  const map = Object.fromEntries(divs.map(x => [x, new Map(d.divisions[x].map(r => [r.hero, r]))]));
  const heroes = [...new Set(divs.flatMap(x => d.divisions[x].map(r => r.hero)))].filter(k => !ui.role || heroInfo(k).role === ui.role);
  const avg = k => { const v = divs.map(x => map[x].get(k)?.[ui.metric]).filter(n => n != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1; };
  heroes.sort((a, b) => avg(b) - avg(a));
  const vals = heroes.flatMap(k => divs.map(x => map[x].get(k)?.[ui.metric])).filter(v => v != null);
  if (!vals.length) { $('#rankHeat').innerHTML = emptyBox('Not published', `The official tables don't include ${ui.metric === 'banrate' ? 'ban rates' : 'this metric'} for these filters.`); return; }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // sequential, single hue: low = dark navy, high = bright cyan
  const cell = v => { if (v == null) return '<span class="hm na">—</span>'; const t = hi === lo ? 0.5 : (v - lo) / (hi - lo); return `<span class="hm" style="--t:${t.toFixed(3)}" data-tip="${pct(v)}"><b class="${t > 0.55 ? 'dark' : ''}">${v.toFixed(1)}</b></span>`; };
  const label = { pickrate: 'pick rate', winrate: 'win rate', banrate: 'ban rate' }[ui.metric];
  $('#rankHeat').innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Meta by rank<small>— ${label}, Competitive Role Queue</small></h2><small class="muted">${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])} · ${d.saved ? 'saved' : 'fetched'} ${esc(timeAgo(d.fetchedAt))}</small></header>
    <div class="scroll-x"><div class="heat" style="--cols:${divs.length}"><span class="hh">Hero</span>${divs.map(x => `<span class="hh">${esc(RANK_SHORT(x))}</span>`).join('')}
    ${heroes.map(k => `<span class="who hero-row" data-hero="${esc(k)}" tabindex="0">${heroPortrait(k, 'portrait')}<b>${esc(heroInfo(k).name)}</b></span>${divs.map(x => cell(map[x].get(k)?.[ui.metric])).join('')}`).join('')}</div></div>
    <div class="heat-legend"><span>${lo.toFixed(1)}%</span><i></i><span>${hi.toFixed(1)}%</span><small>Darker = lower, brighter = higher. Numbers in every cell.</small></div>
    <p class="source-note">One official table per rank from Blizzard via OverFast (saved once a day). Blizzard's top table covers Grandmaster and Champion together. Sorted by the average across ranks. Blizzard does not publish how many games each rank's table covers.</p>`;
}

// ---------- Patch winners & losers: the saved official table before a patch vs after it ----------
// Blizzard's tables restart at each patch, so the "after" copy must be at least PATCH_SETTLE days
// old before it is used (the first days rest on very few games).
const PATCH_SETTLE = 3;
const PATCH_GAP = 2; // same 2-point "even" band as elsewhere
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
async function drawPatch(dateParam) {
  const body = $('#compBody');
  body.innerHTML = `<div class="toolbar" id="patchTools">${loadingBox(1)}</div><section class="panel" id="patchOut">${loadingBox(8)}</section>`;
  let patches = [];
  try { patches = (await loadNews()).patches; } catch (e) { $('#patchOut').innerHTML = errorBox(e); return; }
  if (!patches.length) { $('#patchOut').innerHTML = emptyBox('No patch notes available', 'Blizzard patch notes could not be loaded.'); return; }
  const date = patches.some(p => p.date === dateParam) ? dateParam : patches[0].date;
  const patch = patches.find(p => p.date === date);
  const rankOpts = ui.patchQueue === 'competitive' ? [['all', 'All ranks'], ...DIVISIONS.map(d => [d, RANK_LABEL(d)])] : [['all', 'All players']];
  if (!rankOpts.some(([k]) => k === ui.patchRank)) ui.patchRank = 'all';
  $('#patchTools').innerHTML = `<label class="sel"><span>Patch</span><select id="patchSel">${patches.map(p => `<option value="${p.date}" ${p.date === date ? 'selected' : ''}>${esc(fmtDate(p.date))}</option>`).join('')}</select></label>
    <label class="sel"><span>Queue</span><select id="patchQueue"><option value="competitive" ${ui.patchQueue === 'competitive' ? 'selected' : ''}>Competitive</option><option value="quickplay" ${ui.patchQueue === 'quickplay' ? 'selected' : ''}>Quick Play</option></select></label>
    <label class="sel"><span>Rank</span><select id="patchRank">${rankOpts.map(([k, v]) => `<option value="${k}" ${k === ui.patchRank ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    ${filterSelects({ showRank: false })}<a class="btn sm ghost" href="${esc(safeLink(patch.url))}" target="_blank" rel="noopener">Read patch notes ${icon('i-ext')}</a>`;
  let t;
  try { t = await api('/api/trend?' + qs({ queue: ui.patchQueue, platform: prefs.platform, region: prefs.region, division: ui.patchRank, role: 'all', map: 'all', days: 365 }), { fresh: true }); }
  catch (e) { $('#patchOut').innerHTML = errorBox(e); return; }
  const snaps = t.snapshots || [];
  const ready = addDays(date, PATCH_SETTLE);
  const before = [...snaps].reverse().find(s => s.day < date);
  const after = [...snaps].reverse().find(s => s.day >= ready);
  const scope = `${esc(ui.patchQueue === 'competitive' ? 'Competitive' : 'Quick Play')} · ${esc(ui.patchRank === 'all' ? (ui.patchQueue === 'competitive' ? 'All ranks' : 'All players') : RANK_LABEL(ui.patchRank))} · ${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])}`;
  const head = `<header class="panel-head"><h2>${icon('i-clock')}Patch winners &amp; losers<small>— ${esc(fmtDate(date))}</small></h2><small class="muted">${scope}</small></header>`;
  if (!before || !after) {
    const why = !before ? `OverScope has no copy of the official table from before ${esc(fmtDate(date))}${ui.patchRank !== 'all' ? ' for this rank (per-rank copies started on ' + esc(snaps[0]?.day || 'a later date') + ')' : ''}, so this patch can't be measured.`
      : `Blizzard's tables restart at each patch, so OverScope waits ${PATCH_SETTLE} days for enough games. This patch will be ready on ${esc(fmtDate(ready))}.`;
    $('#patchOut').innerHTML = head + `<div class="state empty"><b>${!before ? 'No “before” copy for this patch' : 'Not ready yet'}</b><p>${why}</p></div>`;
    return;
  }
  const B = new Map(before.rows.map(r => [r.hero, r])), A = new Map(after.rows.map(r => [r.hero, r]));
  const both = [...A.keys()].filter(k => B.has(k)).map(k => ({ hero: k, b: B.get(k), a: A.get(k), dw: A.get(k).winrate - B.get(k).winrate, dp: A.get(k).pickrate - B.get(k).pickrate }));
  const solid = both.filter(x => x.a.pickrate >= 1 && x.b.pickrate >= 1);
  const winUp = solid.filter(x => x.dw >= PATCH_GAP).sort((x, y) => y.dw - x.dw).slice(0, 5);
  const winDown = solid.filter(x => x.dw <= -PATCH_GAP).sort((x, y) => x.dw - y.dw).slice(0, 5);
  const pickUp = both.filter(x => x.dp >= 1).sort((x, y) => y.dp - x.dp).slice(0, 3);
  const pickDown = both.filter(x => x.dp <= -1).sort((x, y) => x.dp - y.dp).slice(0, 3);
  const line = (x, m) => { const v = m === 'w' ? x.dw : x.dp, from = m === 'w' ? x.b.winrate : x.b.pickrate, to = m === 'w' ? x.a.winrate : x.a.pickrate;
    return `<div class="climb-move hero-row" tabindex="0" data-hero="${esc(x.hero)}">${heroPortrait(x.hero, 'portrait')}<span><b>${esc(heroInfo(x.hero).name)}</b><small>${m === 'w' ? 'Win' : 'Pick'} ${pct(from)} → ${pct(to)}</small></span><b class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}</b></div>`; };
  const col = (title, cls, list, m, emptyText) => `<div><h3 class="climb-h ${cls}">${title}</h3>${list.map(x => line(x, m)).join('') || `<p class="muted small">${emptyText}</p>`}</div>`;
  const delta = v => !Number.isFinite(v) ? '—' : `<span class="${v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat'}">${v > 0 ? '+' : ''}${v.toFixed(1)}</span>`;
  const all = [...both].filter(x => !ui.role || heroInfo(x.hero).role === ui.role).sort((x, y) => Math.abs(y.dw) - Math.abs(x.dw));
  $('#patchOut').innerHTML = head + `<div class="climb-cols">
      ${col('Winners', 'up', winUp, 'w', `No hero gained ${PATCH_GAP}+ win-rate points.`)}
      ${col('Losers', 'down', winDown, 'w', `No hero lost ${PATCH_GAP}+ win-rate points.`)}
      ${col('Picked more', 'up', pickUp, 'p', 'No hero gained 1+ pick-rate point.')}
      ${col('Picked less', 'down', pickDown, 'p', 'No hero lost 1+ pick-rate point.')}</div>
    <details class="vr-all patch-all"><summary>All ${all.length} heroes</summary><div class="table cmp-table"><div class="tr th"><span>Hero</span><span>Pick before</span><span>Pick after</span><span>Δ pick</span><span>Win before</span><span>Win after</span><span>Δ win</span></div>
    ${all.map(x => { const h = heroInfo(x.hero); return `<div class="tr hero-row" tabindex="0" data-hero="${esc(x.hero)}"><span class="who">${heroPortrait(x.hero, 'portrait')}<span><b>${esc(h.name)}</b><small>${roleIcon(h.role)}${esc(ROLE_NAME[h.role] || '')}</small></span></span><span>${pct(x.b.pickrate)}</span><span>${pct(x.a.pickrate)}</span><span>${delta(x.dp)}</span><span>${pct(x.b.winrate)}</span><span>${pct(x.a.winrate)}</span><span>${delta(x.dw)}</span></div>`; }).join('')}</div></details>
    <p class="source-note">Before = official table saved ${esc(fmtDate(before.day))} (the last copy before the patch); after = official table saved ${esc(fmtDate(after.day))}. Winners and losers need a ${PATCH_GAP}-point win-rate change and at least 1% pick rate before and after. Other things can change at the same time (a new season, events), so a change is not proof the patch caused it.</p>`;
}

// ---------- Climb guide: best picks at a rank, and what changes one rank higher ----------
// Only Blizzard's published per-rank pick and win rates are used (saved daily by the site's job).
const CLIMB_GAP = 2; // win-rate points a hero must move between ranks to be listed (same "even" band as Player vs Player)
async function drawClimb() {
  const body = $('#compBody');
  const ranks = DIVISIONS;
  const rank = ranks.includes(ui.climbRank) ? ui.climbRank : ranks.includes(prefs.division) ? prefs.division : 'gold';
  ui.climbRank = rank;
  body.innerHTML = `<div class="toolbar"><label class="sel"><span>Your rank</span><select id="climbRank">${ranks.map(d => `<option value="${d}" ${d === rank ? 'selected' : ''}>${esc(RANK_LABEL(d))}</option>`).join('')}</select></label>${filterSelects({ showRank: false })}</div>
    <section class="panel" id="climbBest">${loadingBox(6)}</section><section class="panel" id="climbMove"></section>`;
  let d;
  try { d = await api('/api/stats/by-rank?' + qs({ platform: prefs.platform, region: prefs.region }), { ttl: 30 * 60_000 }); }
  catch (e) { $('#climbBest').innerHTML = errorBox(e); return; }
  const rows = d.divisions?.[rank] || [];
  if (!rows.length) { $('#climbBest').innerHTML = emptyBox('No table for this rank', 'Blizzard did not return hero rates for this rank.'); return; }
  const scored = computeTiers(rows, k => heroInfo(k).role);
  const card = r => `<div class="climb-card hero-row" tabindex="0" data-hero="${esc(r.hero)}">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(heroInfo(r.hero).name)}</b><small>${pct(r.winrate)} win · ${pct(r.pickrate)} pick</small></span><span class="tier-chip t-${esc(r.tier || '')}">${esc(r.tier || '')}</span></div>`;
  $('#climbBest').innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Best picks at ${esc(RANK_LABEL(rank))}</h2><small class="muted">${esc(INPUT_NAME[prefs.platform])} · ${esc(REGION_NAME[prefs.region])}</small></header>
    <div class="climb-roles">${['tank', 'damage', 'support'].map(role => `<div><h3 class="climb-h">${roleIcon(role)}${esc(ROLE_NAME[role])}</h3>${scored.filter(r => r.role === role).slice(0, 3).map(card).join('')}</div>`).join('')}</div>
    <p class="source-note">The top 3 per role by OverScope's tier score at this rank: win rate counts more when a hero is picked often, so a rarely played hero with a high win rate doesn't top the list. Blizzard's numbers cover the current patch and don't include game counts.</p>`;
  const i = ranks.indexOf(rank), top = i === ranks.length - 1;
  // Compare with two ranks up (where you're climbing to); neighbouring ranks barely differ.
  const other = top ? ranks[i - 2] : ranks[Math.min(i + 2, ranks.length - 1)];
  const oRows = new Map((d.divisions?.[other] || []).map(r => [r.hero, r]));
  const moves = rows.filter(r => r.pickrate >= 1 && (oRows.get(r.hero)?.pickrate ?? 0) >= 1)
    .map(r => ({ ...r, other: oRows.get(r.hero), diff: top ? r.winrate - oRows.get(r.hero).winrate : oRows.get(r.hero).winrate - r.winrate }));
  const falls = moves.filter(m => m.diff <= -CLIMB_GAP).sort((a, b) => a.diff - b.diff).slice(0, 6);
  const rises = moves.filter(m => m.diff >= CLIMB_GAP).sort((a, b) => b.diff - a.diff).slice(0, 6);
  const [lo, hi] = top ? [other, rank] : [rank, other];
  const line = m => `<div class="climb-move hero-row" tabindex="0" data-hero="${esc(m.hero)}">${heroPortrait(m.hero, 'portrait')}<span><b>${esc(heroInfo(m.hero).name)}</b><small>${esc(RANK_SHORT(lo))} ${pct(top ? m.other.winrate : m.winrate)} → ${esc(RANK_SHORT(hi))} ${pct(top ? m.winrate : m.other.winrate)}</small></span><b class="${m.diff > 0 ? 'up' : 'down'}">${m.diff > 0 ? '+' : '−'}${Math.abs(m.diff).toFixed(1)}</b></div>`;
  $('#climbMove').innerHTML = `<header class="panel-head"><h2>${icon('i-chart')}${top ? `From ${esc(RANK_LABEL(other))} to ${esc(RANK_LABEL(rank))}` : `Climbing from ${esc(RANK_LABEL(rank))} to ${esc(RANK_LABEL(other))}`}</h2></header>
    <div class="climb-cols"><div><h3 class="climb-h down">${top ? 'Worse at the top' : 'Falls off as you climb'}</h3>${falls.map(line).join('') || `<p class="muted small">No hero drops ${CLIMB_GAP}+ points.</p>`}</div>
    <div><h3 class="climb-h up">${top ? 'Better at the top' : 'Gets better as you climb'}</h3>${rises.map(line).join('') || `<p class="muted small">No hero gains ${CLIMB_GAP}+ points.</p>`}</div></div>
    <p class="source-note">Win rate at ${esc(RANK_LABEL(lo))} vs ${esc(RANK_LABEL(hi))}, heroes with at least 1% pick rate at both ranks, listed only when the gap is ${CLIMB_GAP}+ points. A hero that falls off can still win games now; it just tends to work less well as opponents get better.</p>`;
}
