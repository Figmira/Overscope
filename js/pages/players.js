import { $, esc, pct, api, qs, prefs, heroInfo, heroPortrait, icon, roleIcon, errorBox, loadingBox, emptyBox, relay, cssUrl, timeAgo, toast, ROLE_NAME, favorites, isFavPlayer, toggleFavPlayer, starBtn, rankLabel, cap } from '../lib.js';
import { heroes as loadHeroes, go } from '../app.js';
import { lines, ROLE_COLOR, OPEN_COLOR } from '../charts.js';

// Blizzard's public profile holds Competitive stats for the CURRENT season only; Quick Play is lifetime.
const seasonOf = p => (p?.competitive?.pc || p?.competitive?.console)?.season;
const modeLabel = (m, p) => (m === 'competitive' ? `Competitive · ${seasonOf(p) ? 'Season ' + seasonOf(p) : 'this season'}` : 'Quick Play · lifetime');
const hours = s => (s == null ? '—' : s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min');
const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const ROLE_STYLE = { tank: { color: ROLE_COLOR.tank, shape: 'square', dash: '' }, damage: { color: ROLE_COLOR.damage, shape: 'triangle', dash: '6 3' }, support: { color: ROLE_COLOR.support, shape: 'circle', dash: '2 3' }, open: { color: OPEN_COLOR, shape: 'diamond', dash: '9 3 2 3' } };

export async function render({ main, route, signal }) {
  await loadHeroes().catch(() => {});
  const q = route.query.get('q') || '';
  const isCompare = route.param === 'compare';
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Player tracker · public profiles</p><h1>${isCompare ? 'Player <em>vs</em> player' : 'Find a <em>player</em>'}</h1><p>${isCompare ? 'Two public profiles side by side: ranks, career totals, roles and most-played heroes.' : 'Search a BattleTag to see public ranks, career stats, role performance, most-played heroes and rank history. Private profiles only show what Blizzard makes public.'}</p></header>
    <form class="toolbar" id="pSearch"><label class="field wide">${icon('i-search')}<input id="pQ" value="${esc(q)}" placeholder="BattleTag, e.g. Name-1234 (or just Name)" aria-label="BattleTag" required></label><button class="btn primary">Search</button><a class="btn ghost" href="#/players/compare">Player vs player</a></form>
    <div id="pResults"></div><div id="pProfile"></div></div>`;
  $('#pSearch').addEventListener('submit', e => { e.preventDefault(); go('#/players?q=' + encodeURIComponent($('#pQ').value.trim())); }, { signal });
  main.addEventListener('click', onClick, { signal });
  main.addEventListener('change', e => {
    if (e.target.id === 'deepHero' || e.target.id === 'deepMode') drawDeep();
    if (e.target.id === 'vsPlat') { vs.platform = e.target.value; drawVsRank(); }
    if (e.target.id === 'vsRegion') { vs.region = e.target.value; drawVsRank(); }
  }, { signal });
  main.addEventListener('submit', e => {
    if (e.target.id === 'cmpForm') { e.preventDefault(); const a = $('#cmpA').value.trim().replace('#', '-'), b = $('#cmpB').value.trim().replace('#', '-'); if (a && b) go(`#/players/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`); }
    if (e.target.id === 'vsForm') { e.preventDefault(); const b = $('#vsB').value.trim().replace('#', '-'); if (b) go(`#/players/compare?a=${encodeURIComponent(current.id)}&b=${encodeURIComponent(b)}`); }
  }, { signal });
  if (isCompare) return compare(route.query.get('a') || '', route.query.get('b') || '');
  if (route.param) return profile(route.param);
  if (q) return search(q);
  landing();
}

// ---------- You vs your rank: the player's hero win rates next to Blizzard's average at their Role Queue rank ----------
const MIN_GAMES = 5;
const vs = { platform: '', region: '' };
async function drawVsRank() {
  const el = $('#vsRank'); const p = current;
  const roleRanked = plat => ['tank', 'damage', 'support'].some(r => p.competitive[plat]?.[r]);
  const plats = ['pc', 'console'].filter(roleRanked);
  if (!plats.length) { el.hidden = true; return; } // Open Queue only: Blizzard publishes no Open Queue averages to compare with
  if (!plats.includes(vs.platform)) vs.platform = plats[0];
  vs.region ||= prefs.region || 'americas';
  let heroes, table;
  try {
    [heroes, table] = await Promise.all([
      api(`/api/players/${encodeURIComponent(p.id)}/comp-heroes?` + qs({ platform: vs.platform })),
      api('/api/stats/by-rank?' + qs({ platform: vs.platform, region: vs.region }), { ttl: 30 * 60_000 }),
    ]);
  } catch { el.hidden = true; return; }
  const ranks = p.competitive[vs.platform];
  const rows = heroes.map(h => {
    const role = heroInfo(h.hero).role, rk = ranks[role];
    if (!rk || h.gamesPlayed < MIN_GAMES || h.winrate == null) return null;
    const div = rk.division === 'champion' ? 'grandmaster' : rk.division;
    const avg = table.divisions?.[div]?.find(r => r.hero === h.hero);
    return avg ? { ...h, role, rk, div, avg: avg.winrate, diff: h.winrate - avg.winrate } : null;
  }).filter(Boolean).sort((a, b) => b.gamesPlayed - a.gamesPlayed);
  if (!rows.length) { el.hidden = true; return; }
  const season = ranks.season ? `Season ${ranks.season}` : 'this season';
  el.hidden = false;
  el.innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}You vs your rank<small>— Role Queue</small></h2>
      <div class="toolbar tight0">${plats.length > 1 ? `<label class="sel"><span>Platform</span><select id="vsPlat">${plats.map(x => `<option value="${x}" ${x === vs.platform ? 'selected' : ''}>${x.toUpperCase()}</option>`).join('')}</select></label>` : ''}
      <label class="sel"><span>Region</span><select id="vsRegion">${['americas', 'europe', 'asia'].map(x => `<option value="${x}" ${x === vs.region ? 'selected' : ''}>${cap(x)}</option>`).join('')}</select></label></div></header>
    <div class="table vs-rank"><div class="tr th"><span>Hero</span><span>Your games</span><span>Your win rate</span><span>Average at your rank</span><span>Difference</span></div>
    ${rows.map(r => `<div class="tr hero-row" tabindex="0" data-hero="${esc(r.hero)}"><span class="who">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(heroInfo(r.hero).name)}</b><small>${roleIcon(r.role)}${esc(cap(r.rk.division))} ${esc(r.rk.tier ?? '')}</small></span></span>
      <span>${num(r.gamesPlayed)}</span><span>${pct(r.winrate)}</span><span>${pct(r.avg)} <small class="muted">${esc(cap(r.div))}</small></span>
      <span><b class="${r.diff > 0.05 ? 'up' : r.diff < -0.05 ? 'down' : ''}">${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} pts</b></span></div>`).join('')}</div>
    <p class="source-note">Your numbers: Competitive ${esc(season)} on ${esc(vs.platform.toUpperCase())} (Blizzard counts Role Queue and Open Queue games together here), heroes with ${MIN_GAMES}+ games, compared with your rank in that hero's role. Average: Blizzard's official Role Queue win rate for that rank (${esc(cap(vs.region))}, current patch)${rows.some(r => r.rk.division === 'champion') ? '; Champion is compared with Grandmaster because Blizzard publishes no separate Champion table' : ''}. Blizzard does not publish which region a player is in, so pick yours. Small game counts swing a lot.</p>`;
}

async function onClick(e) {
  const dp = e.target.closest('[data-deepplat]'); if (dp) { deep.platform = dp.dataset.deepplat; return drawDeep(); }
  const h = e.target.closest('[data-hero]'); if (h) return go('#/heroes/' + h.dataset.hero);
  const t = e.target.closest('[data-mode]'); if (t) { $('#main').dataset.mode = t.dataset.mode; return drawStats(); }
  const f = e.target.closest('[data-fav]');
  if (f && current) {
    const on = await toggleFavPlayer({ id: current.id, name: current.username, avatar: current.avatar });
    f.outerHTML = starBtn(on, 'data-fav', 'Favorite');
    toast(on ? `${current.username} saved to favorites in this browser` : 'Removed from favorites');
  }
  const rm = e.target.closest('[data-unfav]');
  if (rm) { await toggleFavPlayer({ id: rm.dataset.unfav }); landing(); }
}

function landing() {
  const favs = favorites().players;
  $('#pResults').innerHTML = `<div class="two">
    <section class="panel"><header class="panel-head"><h2>${icon('i-user')}Favorite players</h2><small class="muted">saved in this browser only</small></header>
      ${favs.length ? `<div class="player-list">${favs.map(p => `<span class="player-card"><a href="#/players/${encodeURIComponent(p.id)}">${p.avatar ? `<img src="${esc(relay(p.avatar))}" alt="" width="52" height="52">` : '<span class="avatar-ph"></span>'}</a><a href="#/players/${encodeURIComponent(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.id)}</small></a><button class="x" data-unfav="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button></span>`).join('')}</div>`
        : emptyBox('No favorites yet', 'Open a profile and press <strong>☆ Favorite</strong> to keep it here.')}</section>
    <section class="panel"><header class="panel-head"><h2>${icon('i-group')}Player vs player</h2></header>
      <form class="prose cmp-form" id="cmpForm"><label class="field">${icon('i-user')}<input id="cmpA" placeholder="First BattleTag" required aria-label="First BattleTag" value="${esc(favs[0]?.id || '')}"></label><label class="field">${icon('i-user')}<input id="cmpB" placeholder="Second BattleTag" required aria-label="Second BattleTag"></label><button class="btn primary">Compare</button></form></section>
  </div>`;
}

async function search(q) {
  const tag = q.replace('#', '-');
  if (/^.+-\d{3,6}$/.test(tag)) return go('#/players/' + encodeURIComponent(tag));
  const el = $('#pResults');
  el.innerHTML = loadingBox(3);
  try {
    const r = await api('/api/players?' + qs({ name: tag }));
    el.innerHTML = r.results.length ? `<section class="panel"><header class="panel-head"><h2>${icon('i-user')}${r.total} public match${r.total === 1 ? '' : 'es'}</h2></header><div class="player-list">${r.results.map(p => `<a href="#/players/${encodeURIComponent(p.id)}" class="player-card">${p.avatar ? `<img src="${esc(relay(p.avatar))}" alt="" width="52" height="52" loading="lazy">` : '<span class="avatar-ph"></span>'}<span><b>${esc(p.name)}</b><small>${esc(p.title || 'Public profile')}${p.isPublic ? '' : ' · private'}</small></span>${icon('i-right')}</a>`).join('')}</div></section>`
      : emptyBox('No public players found', `Nobody matching “${esc(q)}” was found. Names are case-sensitive, and private profiles don't appear in search.`);
  } catch (e) { el.innerHTML = errorBox(e); }
}

let current = null;
async function profile(id) {
  const el = $('#pProfile');
  el.innerHTML = loadingBox(6);
  let tracked = false;
  try { const r = await api('/api/players/' + encodeURIComponent(id), { fresh: true }); current = r.data; }
  catch (e) {
    if (e.status !== 404) { el.innerHTML = errorBox(e); return; }
    // Not found by exact BattleTag: show the public players with that name instead (like Blizzard's own search).
    const name = String(id).replace(/[-#]\d{3,6}$/, '');
    let same = [];
    try { same = (await api('/api/players?' + qs({ name }))).results || []; } catch { /* list is optional */ }
    el.innerHTML = emptyBox('No public profile for this BattleTag', `Blizzard has no public career profile for <strong>${esc(String(id).replace(/-(\d+)$/, '#$1'))}</strong> right now, so there are no stats to show. This happens when a profile is private, when the account hasn't played recently, or when the BattleTag is mistyped.`)
      + (same.length ? `<section class="panel"><header class="panel-head"><h2>${icon('i-user')}${same.length} public player${same.length === 1 ? '' : 's'} named ${esc(name)}</h2></header><p class="source-note">Blizzard hides the number after the name in its search, so these may be other people with the same name. Check the icon and title.</p><div class="player-list">${same.map(x => `<a href="#/players/${encodeURIComponent(x.id)}" class="player-card">${x.avatar ? `<img src="${esc(relay(x.avatar))}" alt="" width="52" height="52" loading="lazy">` : '<span class="avatar-ph"></span>'}<span><b>${esc(x.name)}</b><small>${esc(x.title || 'Public profile')}${x.lastUpdated ? ` · active ${esc(timeAgo(x.lastUpdated * 1000))}` : ''}</small></span>${icon('i-right')}</a>`).join('')}</div></section>` : '');
    return;
  }
  const p = current;
  const fav = isFavPlayer(p.id);
  const rankCell = (role, r) => `<div class="rank-cell">${r?.rankIcon ? `<img class="os-img rank-img" src="${esc(relay(r.rankIcon))}" alt="${esc(r.division)} rank icon" width="48" height="48" data-fallback="${esc(r.division)}" data-role="none">` : '<span class="rank-ph"></span>'}<span><small>${roleIcon(role)}${role === 'open' ? 'Open Queue' : ROLE_NAME[role]}</small><b>${r ? esc(cap(r.division)) + ' ' + esc(r.tier ?? '') : 'Unranked / hidden'}</b></span></div>`;
  const comp = p.competitive.pc || p.competitive.console;
  const heroesPlayed = [...new Set([...(p.stats.competitive?.heroes || []), ...(p.stats.quickplay?.heroes || [])].map(h => h.hero))];
  el.innerHTML = `<section class="profile-head" style="${esc(cssUrl(p.namecard) ? `--namecard:${cssUrl(p.namecard)}` : '')}">
      ${p.avatar ? `<img class="avatar" src="${esc(relay(p.avatar))}" alt="${esc(p.username)} avatar" width="96" height="96">` : '<span class="avatar avatar-ph"></span>'}
      <div class="ph-copy"><p class="eyebrow">${esc(p.title || 'Public Battle.net profile')}</p><h1>${esc(p.username || p.id)}</h1><p class="muted">${esc(p.id.includes('|') ? p.username : p.id)}${p.endorsement ? ` · Endorsement level ${p.endorsement}` : ''}${p.lastUpdated ? ` · Blizzard profile updated ${esc(timeAgo(p.lastUpdated * (p.lastUpdated < 1e12 ? 1000 : 1)))}` : ''}</p></div>
      <div class="ph-actions">${starBtn(fav, 'data-fav', 'Favorite')}
        <form id="vsForm" class="inline"><input id="vsB" placeholder="Compare with… Name-1234" aria-label="Compare with another BattleTag"><button class="btn sm">VS</button></form></div>
    </section>
    ${p.privacy !== 'public' ? `<div class="state unavailable"><b>This profile looks private (or has no stats yet)</b><p>Blizzard only exposes career data for public profiles. In Overwatch: Options → Social → Career Profile Visibility → Public. Data refreshes after the next match.</p></div>` : ''}
    <section class="panel"><header class="panel-head"><h2>${icon('i-laurel')}Competitive ranks${comp?.season ? `<small>— season ${comp.season}${p.competitive.pc ? ' · PC' : ' · console'}</small>` : ''}</h2></header>
      ${comp ? `<div class="ranks">${['tank', 'damage', 'support', 'open'].filter(r => r !== 'open' || comp[r]).map(r => rankCell(r, comp[r])).join('')}</div>` : emptyBox('No competitive ranks visible', 'This player has no public ranks this season.')}</section>
    <section class="panel" id="vsRank" hidden></section>
    <section class="panel" id="histPanel">${loadingBox(3)}</section>
    <div class="toolbar"><div class="seg" id="modeTabs"></div></div>
    <div id="pStats"></div>
    <section class="panel" id="deepPanel"><header class="panel-head"><h2>${icon('i-mask')}Hero deep dive</h2><div class="toolbar tight0">
      <label class="sel"><span>Hero</span><select id="deepHero">${heroesPlayed.map(k => `<option value="${esc(k)}">${esc(heroInfo(k).name)}</option>`).join('')}</select></label>
      <label class="sel"><span>Mode</span><select id="deepMode"><option value="competitive">Competitive</option><option value="quickplay">Quick Play</option></select></label></div></header><div id="deepOut">${heroesPlayed.length ? loadingBox(3) : emptyBox('No hero data', 'This profile has no public hero stats.')}</div></section>`;
  drawStats();
  drawVsRank();
  drawHistory();
  if (heroesPlayed.length) drawDeep();
}

function drawStats() {
  if (!current) return;
  const mode = document.querySelector('#main').dataset.mode || 'competitive';
  $('#modeTabs').innerHTML = ['competitive', 'quickplay'].map(m => `<button class="${m === mode ? 'on' : ''}" data-mode="${m}">${esc(modeLabel(m, current))}</button>`).join('');
  const s = current.stats[mode];
  const el = $('#pStats');
  if (!s || s.error) { el.innerHTML = s?.status === 404 ? emptyBox('No career stats', 'Nothing public for this mode.') : errorBox(s?.error || 'No data'); return; }
  const g = s.general;
  if (!g || !g.gamesPlayed) { el.innerHTML = emptyBox('No career stats for this mode', 'Either the profile is private or no games have been played in this mode.'); return; }
  const roles = Object.entries(s.roles || {}).filter(([, v]) => v?.timePlayed);
  el.innerHTML = `<div class="stat-tiles">
      <div class="tile"><small>Games</small><b>${num(g.gamesPlayed)}</b></div>
      <div class="tile"><small>Won · Lost</small><b>${num(g.gamesWon)} · ${num(g.gamesLost)}</b></div>
      <div class="tile"><small>Win rate</small><b>${pct(g.winrate)}</b></div>
      <div class="tile"><small>KDA</small><b>${g.kda ?? '—'}</b></div>
      <div class="tile"><small>Time played</small><b>${hours(g.timePlayed)}</b></div></div>
    <div class="two">
      <section class="panel"><header class="panel-head"><h2>${icon('i-group')}Role performance</h2></header>${roles.length ? `<div class="table mini-table"><div class="tr th"><span>Role</span><span>Games</span><span>Win rate</span><span>KDA</span><span>Time</span></div>${roles.map(([r, v]) => `<div class="tr"><span>${roleIcon(r)} ${ROLE_NAME[r] || r}</span><span>${num(v.gamesPlayed)}</span><span>${pct(v.winrate)}</span><span>${v.kda ?? '—'}</span><span>${hours(v.timePlayed)}</span></div>`).join('')}</div>` : emptyBox('No role data', '')}</section>
      <section class="panel"><header class="panel-head"><h2>${icon('i-mask')}Most played heroes</h2></header>${s.heroes.length ? `<div class="table mini-table per10"><div class="tr th"><span>Hero</span><span>Time</span><span>Win rate</span><span title="Eliminations per 10 minutes">Elims/10</span><span title="Deaths per 10 minutes">Deaths/10</span></div>${s.heroes.slice(0, 10).map(h => `<div class="tr hero-row" tabindex="0" data-hero="${esc(h.hero)}"><span class="who">${heroPortrait(h.hero, 'portrait')}<b>${esc(heroInfo(h.hero).name)}</b></span><span>${hours(h.timePlayed)}</span><span>${pct(h.winrate)}</span><span>${num(h.average?.eliminations, 1)}</span><span>${num(h.average?.deaths, 1)}</span></div>`).join('')}</div>` : emptyBox('No hero data', '')}</section>
    </div><p class="source-note">Public career profile from Blizzard via OverFast API. ${mode === 'competitive' ? `Competitive values cover ${esc(seasonOf(current) ? 'Season ' + seasonOf(current) : 'the current season')} only, and Blizzard combines Role Queue and Open Queue games in them (it does not split them). Earlier seasons are not in the public profile.` : 'Quick Play values are lifetime totals.'} "/10" columns are Blizzard's per-10-minute averages.</p>`;
}

async function drawHistory() {
  const el = $('#histPanel');
  const head = `<header class="panel-head"><h2>${icon('i-chart')}Rank &amp; stat history</h2><small class="muted">saved in this browser only</small></header>`;
  try {
    const h = await api(`/api/players/${encodeURIComponent(current.id)}/history`, { fresh: true });
    const snaps = h.snapshots;
    if (!snaps.length) { el.innerHTML = head + emptyBox('No history yet', 'Private profiles are not recorded.'); return; }
    const days = snaps.map(s => s.day.slice(5));
    const plat = snaps.some(s => s.comp.pc) ? 'pc' : 'console';
    const series = ['tank', 'damage', 'support', 'open'].map(role => ({ name: role === 'open' ? 'Open Queue' : ROLE_NAME[role], ...ROLE_STYLE[role], values: snaps.map(s => s.comp[plat]?.[role]?.value ?? null) })).filter(s => s.values.some(v => v != null));
    const wr = snaps.map(s => s.stats.competitive?.winrate ?? null);
    const latest = snaps[snaps.length - 1];
    const vals = series.flatMap(s => s.values).filter(v => v != null);
    const rankChart = series.length ? lines(days, series, {
      yMin: Math.max(1, Math.min(...vals) - 3), yMax: Math.min(45, Math.max(...vals) + 3), yFmt: rankLabel, aria: 'Competitive rank over time',
      yTicks: Array.from({ length: 45 }, (_, i) => i + 1).filter(v => v % 5 === 0 && v >= Math.min(...vals) - 3 && v <= Math.max(...vals) + 3).map(v => [v, rankLabel(v)]),
    }) : '';
    el.innerHTML = head + `<div class="hist">
      <div class="chart-wrap">${snaps.length < 2 ? `<div class="state empty small"><b>First snapshot saved ${esc(latest.day)}</b><p>Each day you open this profile, this browser saves one point. Nothing is sent to or stored by OverScope.</p></div>` : (rankChart || emptyBox('No ranked roles', 'No competitive ranks were visible on the saved days.'))}</div>
      <div class="table mini-table hist-table"><div class="tr th"><span>Day</span><span>Ranks (${plat === 'pc' ? 'PC' : 'console'})</span><span>Comp games</span><span>Comp win rate</span></div>
      ${[...snaps].reverse().slice(0, 8).map(s => `<div class="tr"><span>${esc(s.day)}</span><span>${['tank', 'damage', 'support', 'open'].map(r => s.comp[plat]?.[r] ? `${r === 'open' ? 'Open' : ROLE_NAME[r]} ${rankLabel(s.comp[plat][r].value)}` : '').filter(Boolean).join(' · ') || '—'}</span><span>${num(s.stats.competitive?.gamesPlayed)}</span><span>${pct(s.stats.competitive?.winrate)}</span></div>`).join('')}</div></div>
      <p class="source-note">Blizzard only shows a profile as it is now, so this history is built from the days this profile was opened <b>in this browser</b>. It is stored only on this device (clearing browsing data removes it). ${snaps.length} day${snaps.length === 1 ? '' : 's'} recorded since ${esc(snaps[0].day)}.</p>`;
  } catch (e) { el.innerHTML = head + errorBox(e); }
}

const deep = { platform: '' };
async function drawDeep() {
  const out = $('#deepOut'); if (!out) return;
  const hero = $('#deepHero').value, mode = $('#deepMode').value;
  out.innerHTML = loadingBox(3);
  try {
    // Detailed stats are kept per platform; load both and use the one(s) this hero was actually played on.
    const tries = await Promise.all(['pc', 'console'].map(platform => api(`/api/players/${encodeURIComponent(current.id)}/career?` + qs({ gamemode: mode, hero, platform })).then(r => ({ platform, groups: r.data[hero] || [] }), () => ({ platform, groups: [] }))));
    const played = g => g.find(x => x.key === 'game')?.stats.find(s => s.key === 'time_played')?.value || 0;
    const usable = tries.filter(t => t.groups.length && played(t.groups) > 0).sort((a, b) => played(b.groups) - played(a.groups));
    if (!usable.length) { out.innerHTML = emptyBox(`No ${mode === 'competitive' ? 'Competitive' : 'Quick Play'} data for ${esc(heroInfo(hero).name)}`, 'This hero has not been played in this mode, or the profile hides it.'); return; }
    if (!usable.some(t => t.platform === deep.platform)) deep.platform = usable[0].platform;
    const groups = usable.find(t => t.platform === deep.platform).groups;
    const order = ['average', 'hero_specific', 'best', 'combat', 'game', 'assists', 'match_awards', 'miscellaneous'];
    groups.sort((a, b) => (order.indexOf(a.key) + 99) % 99 - (order.indexOf(b.key) + 99) % 99);
    const fmt = (k, v) => /time|played/.test(k) && v > 300 ? hours(v) : /accuracy|percentage|win_percentage/.test(k) ? pct(v, 0) : num(v, v % 1 ? 2 : 0);
    const platPick = usable.length > 1 ? `<div class="seg sm deep-plat">${usable.map(t => `<button class="${t.platform === deep.platform ? 'on' : ''}" data-deepplat="${t.platform}">${t.platform === 'pc' ? 'PC' : 'Console'}</button>`).join('')}</div>` : '';
    out.innerHTML = `${platPick}<div class="deep">${heroPortrait(hero, 'deep-portrait')}<div class="deep-groups">${groups.map(g => `<div class="deep-group"><h3>${esc(cap(g.label))}</h3><dl>${g.stats.slice(0, 12).map(s => `<dt>${esc(cap(s.label))}</dt><dd>${esc(fmt(s.key, s.value))}</dd>`).join('')}</dl></div>`).join('')}</div></div>
      <p class="source-note">Blizzard career statistics for ${esc(heroInfo(hero).name)} (${esc(modeLabel(mode, current))}, ${deep.platform === 'pc' ? 'PC' : 'console'}) via OverFast.${mode === 'competitive' ? ' Competitive includes both Role Queue and Open Queue games; Blizzard does not separate them.' : ''}</p>`;
  } catch (e) { out.innerHTML = errorBox(e); }
}

async function compare(a, b) {
  const el = $('#pProfile');
  if (!a || !b) { $('#pResults').innerHTML = `<section class="panel"><form class="prose cmp-form" id="cmpForm"><label class="field">${icon('i-user')}<input id="cmpA" placeholder="First BattleTag" required value="${esc(a || favorites().players[0]?.id || '')}" aria-label="First BattleTag"></label><span class="vs">VS</span><label class="field">${icon('i-user')}<input id="cmpB" placeholder="Second BattleTag" required value="${esc(b)}" aria-label="Second BattleTag"></label><button class="btn primary">Compare</button></form></section>`; return; }
  el.innerHTML = loadingBox(6);
  const res = await Promise.all([a, b].map(id => api('/api/players/' + encodeURIComponent(id)).then(r => r.data).catch(e => ({ error: e, id }))));
  const bad = res.find(r => r.error);
  if (bad) { el.innerHTML = bad.error.status === 404 ? emptyBox('Player not found', `No profile exists for <strong>${esc(bad.id)}</strong>.`) : errorBox(bad.error); return; }
  const [A, B] = res;
  const plat = p => p.competitive.pc ? 'pc' : p.competitive.console ? 'console' : null;
  const rk = (p, r) => { const c = p.competitive[plat(p)]?.[r]; return c ? `${cap(c.division)} ${c.tier}` : '—'; };
  const row = (label, va, vb, better) => {
    const w = better && va != null && vb != null && va !== vb ? (better(va, vb) ? 'a' : 'b') : '';
    return `<div class="tr"><span class="${w === 'a' ? 'win' : ''}">${va ?? '—'}</span><span class="mid">${label}</span><span class="${w === 'b' ? 'win' : ''}">${vb ?? '—'}</span></div>`;
  };
  const g = (p, m) => p.stats[m]?.general || {};
  const hi = (x, y) => x > y;
  const blocks = ['competitive', 'quickplay'].map(m => {
    const ga = g(A, m), gb = g(B, m);
    return `<section class="panel"><header class="panel-head"><h2>${icon('i-bars')}${m === 'competitive' ? 'Competitive · current season' : 'Quick Play · lifetime'}</h2></header><div class="table vs-table">
      ${row('Games', ga.gamesPlayed, gb.gamesPlayed)}
      ${row('Win rate', ga.winrate != null ? pct(ga.winrate) : null, gb.winrate != null ? pct(gb.winrate) : null)}${''}
      ${row('KDA', ga.kda, gb.kda)}
      ${row('Time played', ga.timePlayed != null ? hours(ga.timePlayed) : null, gb.timePlayed != null ? hours(gb.timePlayed) : null)}
      ${row('Elims / 10 min', ga.average?.eliminations, gb.average?.eliminations)}
      ${row('Deaths / 10 min', ga.average?.deaths, gb.average?.deaths)}
      ${row('Damage / 10 min', ga.average?.damage != null ? num(ga.average.damage) : null, gb.average?.damage != null ? num(gb.average.damage) : null)}
      ${row('Healing / 10 min', ga.average?.healing != null ? num(ga.average.healing) : null, gb.average?.healing != null ? num(gb.average.healing) : null)}
    </div></section>`;
  }).join('');
  // highlight the higher value where "higher is better" without guessing for others
  const top = p => (p.stats.competitive?.heroes?.length ? p.stats.competitive.heroes : p.stats.quickplay?.heroes || []).slice(0, 5);
  const shared = top(A).map(h => h.hero).filter(k => top(B).some(x => x.hero === k));
  el.innerHTML = `<div class="vs-head">
      ${[A, B].map((p, i) => `<a class="vs-card ${i ? 'b' : 'a'}" href="#/players/${encodeURIComponent(p.id)}">${p.avatar ? `<img src="${esc(relay(p.avatar))}" alt="" width="72" height="72">` : '<span class="avatar-ph"></span>'}<span><b>${esc(p.username)}</b><small>${esc(p.title || '')}</small></span></a>`).join('<span class="vs-big">VS</span>')}
    </div>
    <section class="panel"><header class="panel-head"><h2>${icon('i-laurel')}Competitive ranks</h2><small class="muted">${esc(plat(A) || '—')} vs ${esc(plat(B) || '—')}</small></header><div class="table vs-table">${['tank', 'damage', 'support', 'open'].map(r => row(r === 'open' ? 'Open Queue' : ROLE_NAME[r], rk(A, r), rk(B, r))).join('')}</div></section>
    <div class="two">${blocks}</div>
    <section class="panel"><header class="panel-head"><h2>${icon('i-mask')}Most played heroes</h2>${shared.length ? `<small class="muted">Both play: ${shared.map(k => esc(heroInfo(k).name)).join(', ')}</small>` : ''}</header><div class="two tight">${[A, B].map(p => `<div class="table mini-table vs-heroes"><div class="tr th"><span>${esc(p.username)}</span><span>Time</span><span>Win rate</span></div>${top(p).map(h => `<div class="tr hero-row" data-hero="${esc(h.hero)}"><span class="who">${heroPortrait(h.hero, 'portrait')}<b>${esc(heroInfo(h.hero).name)}</b></span><span>${hours(h.timePlayed)}</span><span>${pct(h.winrate)}</span></div>`).join('') || '<p class="muted small">No public hero data</p>'}</div>`).join('')}</div></section>
    <p class="source-note">Both profiles from Blizzard via OverFast. Lifetime totals per mode. Neither player is marked "better" — numbers are shown side by side.</p>`;
}
