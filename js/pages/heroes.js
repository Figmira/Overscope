import { $, $$, esc, pct, api, prefs, setPref, statsPath, heroInfo, heroPortrait, heroArt, icon, roleIcon, roleTabs, errorBox, loadingBox, emptyBox, relay, ROLE_NAME, QUEUE_SHORT, REGION_NAME, roster, getManifest, filterSelects, isFavHero, toggleFavHero, starBtn, favorites, toast, qs, DIVISIONS, cap, timeAgo } from '../lib.js';
import { lines, ROLE_COLOR } from '../charts.js';
import { computeTiers } from '../tiers.js';
import { heroes as loadHeroes, maps as loadMaps, go } from '../app.js';

const ui = { q: '', role: '', fav: false };

export async function render(ctx) {
  if (ctx.route.param) return detail(ctx);
  const { main, signal } = ctx;
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Official roster</p><h1>Meet the <em>heroes</em></h1><p>Every current Overwatch hero with official artwork. Search by name or filter by role, then open a hero for abilities, live rates and Stadium powers.</p></header>
    <div class="toolbar"><label class="field">${icon('i-search')}<input id="heroQ" placeholder="Find a hero…" value="${esc(ui.q)}" aria-label="Search heroes"></label><div id="roleTabs">${roleTabs(ui.role)}</div><button class="chip ${ui.fav ? 'on' : ''}" id="favOnly" aria-pressed="${ui.fav}">★ Favorites</button><span class="count" id="heroCount"></span></div>
    <div id="heroGrid" class="hero-grid">${loadingBox(8)}</div>
  </div>`;
  let list;
  try { list = await loadHeroes(); }
  catch (e) {
    // fall back to the roster in the local asset manifest (labelled)
    list = roster();
    if (!list.length) { $('#heroGrid').innerHTML = errorBox(e); return; }
    $('#heroGrid').insertAdjacentHTML('beforebegin', `<p class="source-note warn">Live roster unavailable (${esc(e.message)}). Showing the roster saved with the downloaded artwork.</p>`);
  }
  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    const favs = favorites().heroes;
    const shown = list.filter(h => (!ui.role || h.role === ui.role) && (!q || h.name.toLowerCase().includes(q)) && (!ui.fav || favs.includes(h.key))).sort((a, b) => a.name.localeCompare(b.name));
    $('#heroCount').textContent = `${shown.length} / ${list.length} heroes`;
    $('#roleTabs').innerHTML = roleTabs(ui.role);
    $('#heroGrid').innerHTML = shown.length ? shown.map(h => `<a class="hero-tile role-${esc(h.role)}" href="#/heroes/${esc(h.key)}">
      ${heroPortrait(h.key, 'tile-img')}${favs.includes(h.key) ? '<span class="tile-star" aria-label="Favorite">★</span>' : ''}<span class="tile-info"><b>${esc(h.name)}</b><small>${roleIcon(h.role)}${esc(ROLE_NAME[h.role])}</small></span></a>`).join('')
      : emptyBox(ui.fav ? 'No favorite heroes yet' : 'No heroes match', ui.fav ? 'Open a hero and press ☆ Favorite.' : 'Try a different name or role.');
  };
  draw();
  $('#heroQ').addEventListener('input', e => { ui.q = e.target.value; draw(); }, { signal });
  main.addEventListener('click', e => {
    const r = e.target.closest('[data-role]'); if (r) { ui.role = r.dataset.role; draw(); }
    if (e.target.closest('#favOnly')) { ui.fav = !ui.fav; const b = $('#favOnly'); b.classList.toggle('on', ui.fav); b.setAttribute('aria-pressed', ui.fav); draw(); }
  }, { signal });
}

async function detail({ main, route, signal }) {
  const key = route.param;
  await loadHeroes().catch(() => {});
  const h = heroInfo(key);
  main.innerHTML = `<div class="page hero-page role-${esc(h.role)}">
    <a class="back" href="#/heroes">${icon('i-left')}All heroes</a>
    <section class="hero-detail-top">
      <div class="hd-art">${heroArt(key, 'hd-img')}</div><div class="hd-shade"></div>
      <div class="hd-copy" id="hdCopy"><p class="eyebrow">${roleIcon(h.role)} ${esc(ROLE_NAME[h.role] || '')}</p><h1>${esc(h.name)}</h1>${loadingBox(3)}</div>
    </section>
    <div class="two">
      <section class="panel" id="hdAbilities">${loadingBox(5)}</section>
      <div class="col">
        <section class="panel" id="hdStats"></section>
        <section class="panel" id="hdMap"></section>
      </div>
    </div>
    <section class="panel" id="hdRank">${loadingBox(5)}</section>
    <section class="panel" id="hdStadium">${loadingBox(3)}</section>
  </div>`;

  // hero detail
  try {
    const d = (await api('/api/heroes/' + key, { ttl: 3600_000 })).data;
    const hp = d.hitpoints || {};
    $('#hdCopy').innerHTML = `<p class="eyebrow">${roleIcon(d.role)} ${esc(ROLE_NAME[d.role] || d.role)}</p><h1>${esc(d.name)}</h1>
      <p class="lede">${esc(d.description)}</p>
      <dl class="facts">${d.location ? `<dt>Location</dt><dd>${esc(d.location)}</dd>` : ''}${d.age ? `<dt>Age</dt><dd>${esc(d.age)}</dd>` : ''}${hp.total ? `<dt>Hit points</dt><dd>${esc(hp.total)} <small>(${[hp.health && hp.health + ' health', hp.armor && hp.armor + ' armor', hp.shields && hp.shields + ' shields'].filter(Boolean).join(' · ')})</small></dd>` : ''}</dl>
      <div class="cta">${starBtn(isFavHero(key), 'data-favhero', 'Favorite')}<a class="btn primary" href="#/stadium/${esc(key)}">${icon('i-stadium')}Stadium powers</a><a class="btn ghost" href="https://overwatch.blizzard.com/en-us/heroes/${esc(key)}/" target="_blank" rel="noopener">Official hero page ${icon('i-ext')}</a></div>`;
    $('#hdAbilities').innerHTML = `<header class="panel-head"><h2>${icon('i-mask')}Abilities</h2></header><ul class="abilities">${d.abilities.map((a, i) => `<li>${a.icon ? `<img src="${esc(relay(a.icon))}" alt="" width="44" height="44" loading="lazy">` : '<span class="ab-ph"></span>'}<div><b>${esc(a.name)}</b><p>${esc(a.description)}</p></div></li>`).join('') || '<li>No ability data returned.</li>'}</ul>`;
    const st = d.stadium || {};
    $('#hdStadium').innerHTML = `<header class="panel-head"><h2>${icon('i-stadium')}Stadium</h2><a class="link-sm" href="#/stadium/${esc(key)}">Open build lab ${icon('i-arrow')}</a></header>` + (st.powers?.length
      ? `<div class="power-list">${st.powers.slice(0, 12).map(p => `<div class="power"><b>${esc(p.name)}</b><p>${esc(p.description)}</p></div>`).join('')}</div>`
      : emptyBox('Stadium powers not provided', 'The hero data source did not include Stadium powers for this hero. The build lab explains current coverage.'));
  } catch (e) {
    $('#hdCopy').innerHTML = `<p class="eyebrow">${esc(ROLE_NAME[h.role] || '')}</p><h1>${esc(h.name)}</h1>` + errorBox(e);
    $('#hdAbilities').innerHTML = errorBox(e);
    $('#hdStadium').innerHTML = '';
  }

  // stats in each queue
  const drawStats = async () => {
    const el = $('#hdStats');
    el.innerHTML = `<header class="panel-head"><h2>${icon('i-bars')}Live hero rates</h2></header><div class="toolbar tight">${filterSelects({ showRank: false })}</div><div id="hdStatGrid">${loadingBox(3)}</div>`;
    const out = await Promise.all(['competitive', 'quickplay'].map(async q => {
      try {
        const s = await api(statsPath({ queue: q, division: '' }));
        if (!s.available) return `<div class="qstat na"><h3>${QUEUE_SHORT[q]}</h3><p>No verified source</p></div>`;
        const rows = [...s.rows].sort((a, b) => b.pickrate - a.pickrate);
        const r = rows.find(x => x.hero === key);
        if (!r) return `<div class="qstat"><h3>${QUEUE_SHORT[q]}</h3><p class="muted">Not in this dataset</p></div>`;
        return `<div class="qstat"><h3>${QUEUE_SHORT[q]}</h3><div><small>Pick</small><b>${pct(r.pickrate)}</b></div><div><small>Win</small><b>${pct(r.winrate)}</b></div>${r.banrate != null ? `<div><small>Ban</small><b>${pct(r.banrate)}</b></div>` : ''}<p class="muted">#${rows.indexOf(r) + 1} of ${rows.length} by pick rate</p></div>`;
      } catch (e) { return `<div class="qstat na"><h3>${QUEUE_SHORT[q]}</h3><p>${esc(e.message)}</p></div>`; }
    }));
    $('#hdStatGrid').innerHTML = `<div class="qstats">${out.join('')}</div><p class="source-note">Official Blizzard rates via OverFast · ${esc(REGION_NAME[prefs.region])} · ${prefs.platform.toUpperCase()} · all ranks. Each queue comes from its own dataset.</p>`;
  };
  // how this hero does at each rank (8 official tables, saved daily by the GitHub Action)
  const drawRank = async () => {
    const el = $('#hdRank');
    if (!el) return;
    let d;
    try { d = await api('/api/stats/by-rank?' + qs({ platform: prefs.platform, region: prefs.region }), { ttl: 30 * 60_000 }); }
    catch (e) { el.innerHTML = `<header class="panel-head"><h2>${icon('i-chart')}By rank</h2></header>` + errorBox(e); return; }
    const divs = DIVISIONS.filter(x => d.divisions[x]?.length);
    const rowAt = x => d.divisions[x].find(r => r.hero === key);
    if (!divs.length || !divs.some(rowAt)) { el.innerHTML = `<header class="panel-head"><h2>${icon('i-chart')}By rank</h2></header>` + emptyBox('No rank data', 'The official rank tables did not include this hero.'); return; }
    const SHORT = { platinum: 'Plat', grandmaster: 'GM' };
    const labels = divs.map(x => SHORT[x] || cap(x));
    const color = ROLE_COLOR[h.role] || '#56d9fb';
    const win = divs.map(x => rowAt(x)?.winrate ?? null), pick = divs.map(x => rowAt(x)?.pickrate ?? null);
    const tiers = divs.map(x => computeTiers(d.divisions[x], k => heroInfo(k).role).find(r => r.hero === key)?.tier || '—');
    const chart = (vals, label, extra) => lines(labels, [{ name: '', color, values: vals }], { width: 520, height: 210, yFmt: v => v.toFixed(1) + '%', aria: `${h.name} ${label} by rank`, xStep: 1, ...extra });
    el.innerHTML = `<header class="panel-head"><h2>${icon('i-chart')}${esc(h.name)} by rank<small>— Competitive Role Queue</small></h2><small class="muted">${esc(REGION_NAME[prefs.region])} · ${prefs.platform.toUpperCase()} · ${d.saved ? 'saved' : 'fetched'} ${esc(timeAgo(d.fetchedAt))}</small></header>
      <div class="tier-strip" aria-label="Tier at each rank">${divs.map((x, i) => `<span class="t-${esc(tiers[i])}" title="${esc(cap(x))}: tier ${esc(tiers[i])}"><b>${esc(tiers[i])}</b><small>${esc(cap(x))}</small></span>`).join('')}</div>
      <div class="byrank"><div><h3>Win rate</h3>${chart(win, 'win rate', { ref: 50, refLabel: '50%' })}</div><div><h3>Pick rate</h3>${chart(pick, 'pick rate')}</div></div>
      <p class="source-note">One official Blizzard table per rank, via OverFast. Tiers use the <a href="#/tier-list">tier list method</a> within each rank. Blizzard does not publish a Champion table or game counts.</p>`;
  };
  drawStats();
  drawRank();
  main.addEventListener('change', e => { const p = e.target.dataset.pref; if (p) { setPref(p, e.target.value); drawStats(); drawMap(); drawRank(); } }, { signal });
  main.addEventListener('click', e => { const f = e.target.closest('[data-favhero]'); if (f) { const on = toggleFavHero(key); f.outerHTML = starBtn(on, 'data-favhero', 'Favorite'); toast(on ? `${h.name} added to favorites` : `${h.name} removed from favorites`); } }, { signal });

  // map-specific performance
  let mapsList = [];
  try { mapsList = (await loadMaps()).data.filter(m => m.gamemodes.some(g => ['control', 'escort', 'hybrid', 'push', 'flashpoint', 'clash'].includes(g))); } catch { /* handled below */ }
  let mapKey = mapsList[0]?.key || '';
  let mq = prefs.queue === 'quickplay' ? 'quickplay' : 'competitive';
  const drawMap = async () => {
    const el = $('#hdMap');
    el.innerHTML = `<header class="panel-head"><h2>${icon('i-map')}Performance by map</h2></header><div class="toolbar tight">
      <label class="sel"><span>Queue</span><select id="hmQueue"><option value="competitive" ${mq === 'competitive' ? 'selected' : ''}>Role Queue</option><option value="quickplay" ${mq === 'quickplay' ? 'selected' : ''}>Quick Play</option></select></label>
      <label class="sel"><span>Map</span><select id="hmMap">${mapsList.map(m => `<option value="${esc(m.key)}" ${m.key === mapKey ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label></div><div id="hmOut">${loadingBox(2)}</div>`;
    if (!mapKey) { $('#hmOut').innerHTML = emptyBox('Maps unavailable', 'The map list could not be loaded.'); return; }
    try {
      const [onMap, overall] = await Promise.all([api(statsPath({ queue: mq, map: mapKey, division: '' })), api(statsPath({ queue: mq, division: '' }))]);
      const r = onMap.rows.find(x => x.hero === key), o = overall.rows.find(x => x.hero === key);
      const mapName = mapsList.find(m => m.key === mapKey)?.name || mapKey;
      $('#hmOut').innerHTML = r ? `<div class="qstats"><div class="qstat"><h3>On ${esc(mapName)}</h3><div><small>Pick</small><b>${pct(r.pickrate)}</b></div><div><small>Win</small><b>${pct(r.winrate)}</b></div></div>
        <div class="qstat"><h3>All maps</h3><div><small>Pick</small><b>${pct(o?.pickrate)}</b></div><div><small>Win</small><b>${pct(o?.winrate)}</b></div></div></div>
        <p class="source-note">This is ${esc(heroInfo(key).name)}'s pick and win rate <b>while playing on ${esc(mapName)}</b> — not how often ${esc(mapName)} is played.</p>`
        : emptyBox('No data for this map', 'The official table has no entry for this hero on this map.');
    } catch (e) { $('#hmOut').innerHTML = errorBox(e); }
  };
  drawMap();
  main.addEventListener('change', e => {
    if (e.target.id === 'hmMap') { mapKey = e.target.value; drawMap(); }
    if (e.target.id === 'hmQueue') { mq = e.target.value; drawMap(); }
  }, { signal });
}
