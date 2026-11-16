import { $, esc, pct, api, prefs, setPref, statsPath, heroInfo, heroPortrait, mapImage, icon, roleIcon, errorBox, loadingBox, emptyBox, toast, ROLE_NAME, QUEUE_NAME, QUEUE_SHORT, REGION_NAME, queueTabs, openQueueUnavailable } from '../lib.js';
import { heroes as loadHeroes, maps as loadMaps, go } from '../app.js';

const ui = { q: '', mode: '', queue: 'competitive' };
// The old "record a match" log was removed; clear anything it left in this browser.
try { localStorage.removeItem('overscope.ledger.v1'); } catch { /* storage off */ }

export async function render(ctx) {
  ui.queue = ['competitive', 'quickplay'].includes(ctx.route.query.get('queue')) ? ctx.route.query.get('queue') : (prefs.queue === 'quickplay' ? 'quickplay' : 'competitive');
  await loadHeroes().catch(() => {});
  let md;
  try { md = await loadMaps(); } catch (e) { ctx.main.innerHTML = `<div class="page">${errorBox(e)}</div>`; return; }
  return ctx.route.param ? detail(ctx, md) : list(ctx, md);
}

function modeOf(m, md) { return m.gamemodes.find(g => md.mechanics[g]) || m.gamemodes[0] || ''; }

function list({ main, signal }, md) {
  const modes = [...new Set(md.data.flatMap(m => m.gamemodes))];
  const gm = Object.fromEntries((md.gamemodes || []).map(g => [g.key, g]));
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Maps · objectives · heroes</p><h1>Know every <em>battleground</em></h1><p>Official map list and screenshots, how each mode is scored, and which heroes win on each map.</p></header>
    <div class="toolbar"><span id="qTabs"></span><label class="field">${icon('i-search')}<input id="mapQ" placeholder="Search maps…" value="${esc(ui.q)}" aria-label="Search maps"></label>
      <label class="sel"><span>Mode</span><select id="mapMode"><option value="">All modes</option>${modes.map(k => `<option value="${esc(k)}" ${ui.mode === k ? 'selected' : ''}>${esc(gm[k]?.name || md.mechanics[k]?.name || k)}</option>`).join('')}</select></label><span class="count" id="mapCount"></span></div>
    <div class="map-grid" id="mapGrid"></div>
    <p class="source-note">Map list and screenshots: OverFast API /maps (Blizzard imagery), fetched ${esc(new Date(md.fetchedAt).toLocaleString())}${md.stale ? ' — saved copy, live refresh failed' : ''}.</p></div>`;

  const draw = () => {
    $('#qTabs').innerHTML = queueTabs(ui.queue);
    const q = ui.q.trim().toLowerCase();
    const shown = md.data.filter(m => (!ui.mode || m.gamemodes.includes(ui.mode)) && (!q || m.name.toLowerCase().includes(q)));
    $('#mapCount').textContent = `${shown.length} maps`;
    $('#mapGrid').innerHTML = shown.length ? shown.map(m => {
      const mode = modeOf(m, md);
      return `<a class="map-card" href="#/maps/${esc(m.key)}?queue=${ui.queue}">${mapImage(m.key, m.name, 'map-card-img')}<span class="map-meta"><span><b>${esc(m.name)}</b><small>${esc(m.location)}</small></span><span class="tag">${esc(gm[mode]?.name || md.mechanics[mode]?.name || mode)}</span></span></a>`;
    }).join('') : emptyBox('No maps match', 'Try another search or mode.');
  };
  draw();
  main.addEventListener('input', e => { if (e.target.id === 'mapQ') { ui.q = e.target.value; const pos = e.target.selectionStart; draw(); const f = $('#mapQ'); f.focus(); f.setSelectionRange(pos, pos); } }, { signal });
  main.addEventListener('change', e => { if (e.target.id === 'mapMode') { ui.mode = e.target.value; draw(); } }, { signal });
  main.addEventListener('click', e => {
    const qb = e.target.closest('[data-queue]'); if (qb) { ui.queue = qb.dataset.queue; draw(); }
  }, { signal });
}

async function detail({ main, route, signal }, md) {
  const m = md.data.find(x => x.key === route.param);
  if (!m) { main.innerHTML = `<div class="page">${emptyBox('Map not found', 'That map is not in the current official list.', '<a class="btn sm" href="#/maps">All maps</a>')}</div>`; return; }
  const mode = modeOf(m, md);
  const mech = md.mechanics[mode];
  const official = (md.gamemodes || []).find(g => g.key === mode);
  main.innerHTML = `<div class="page">
    <a class="back" href="#/maps">${icon('i-left')}All maps</a>
    <section class="map-detail-hero">${mapImage(m.key, m.name, 'map-detail-img', false)}<div class="md-label"><p class="eyebrow">${esc(official?.name || mech?.name || mode)}</p><h1>${esc(m.name)}</h1><p>${esc(m.location)}</p></div></section>
    <div class="two">
      <section class="panel"><header class="panel-head"><h2>${icon('i-info')}Objective & scoring</h2></header><div class="prose">
        ${official?.description ? `<p class="lede">${esc(official.description)}</p><p class="muted small">Official mode description (Blizzard, via OverFast).</p>` : ''}
        ${mech ? `<h3>How it is scored</h3><p>${esc(mech.scoring)}</p>
        <div class="phases">${mech.phases.map((p, i) => `<div><span>${String(i + 1).padStart(2, '0')}</span>${esc(p)}</div>`).join('')}</div>
        <h3>${mech.symmetric ? 'Both teams' : 'Attackers'}</h3><p>${esc(mech.attack)}</p>${mech.symmetric ? '' : `<h3>Defenders</h3><p>${esc(mech.defend)}</p>`}`
        : `<p>This map is used in ${esc(m.gamemodes.join(', '))}, which is outside the core competitive modes.</p>`}
        <p class="muted small">Also listed for: ${esc(m.gamemodes.join(', '))}</p></div></section>
      <section class="panel" id="mdHeroes"></section>
    </div></div>`;

  const drawHeroes = async () => {
    const el = $('#mdHeroes');
    el.innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Hero performance on ${esc(m.name)}</h2></header><div class="toolbar tight">${queueTabs(ui.queue)}</div><div id="mdOut">${loadingBox(5)}</div>`;
    try {
      const s = await api(statsPath({ queue: ui.queue, map: m.key, division: '' }));
      const rows = [...s.rows].sort((a, b) => b.pickrate - a.pickrate).slice(0, 10);
      $('#mdOut').innerHTML = rows.length ? `<div class="table mini-table"><div class="tr th"><span>#</span><span>Hero</span><span>Pick on map</span><span>Win on map</span></div>${rows.map((r, i) => `<div class="tr hero-row" tabindex="0" data-hero="${esc(r.hero)}"><span class="rank">${i + 1}</span><span class="who">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(heroInfo(r.hero).name)}</b><small>${roleIcon(heroInfo(r.hero).role)}${esc(ROLE_NAME[heroInfo(r.hero).role] || '')}</small></span></span><span class="num"><b>${pct(r.pickrate)}</b></span><span class="num"><b>${pct(r.winrate)}</b></span></div>`).join('')}</div>
        <p class="source-note">Official hero rates <b>while playing on ${esc(m.name)}</b> · ${esc(QUEUE_NAME[ui.queue])} · ${esc(REGION_NAME[prefs.region])} · ${prefs.platform.toUpperCase()} · all ranks · fetched ${esc(new Date(s.source.fetchedAt).toLocaleString())}. These are not map appearance rates.</p>`
        : emptyBox('No published data for this map', 'The official table has no hero rates for this map with these filters (common for non-competitive maps).');
    } catch (e) { $('#mdOut').innerHTML = errorBox(e); }
  };
  drawHeroes();
  main.addEventListener('click', e => {
    const qb = e.target.closest('[data-queue]'); if (qb) { ui.queue = qb.dataset.queue; drawHeroes(); return; }
    const h = e.target.closest('[data-hero]'); if (h) go('#/heroes/' + h.dataset.hero);
  }, { signal });
}
