import { $, esc, pct, api, prefs, setPref, statsPath, heroInfo, heroPortrait, mapImage, icon, roleIcon, errorBox, loadingBox, emptyBox, toast, ROLE_NAME, QUEUE_NAME, QUEUE_SHORT, REGION_NAME, queueTabs, openQueueUnavailable } from '../lib.js';
import { heroes as loadHeroes, maps as loadMaps, go } from '../app.js';

const LEDGER = 'overscope.ledger.v1';
const ui = { q: '', mode: '', queue: 'competitive' };
const readLedger = () => { try { const x = JSON.parse(localStorage.getItem(LEDGER) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const saveLedger = l => { try { localStorage.setItem(LEDGER, JSON.stringify(l)); } catch { toast('Browser storage is unavailable'); } };
const share = (ledger, queue, key) => { const l = ledger.filter(x => x.queue === queue); const n = l.filter(x => x.map === key).length; return { n, total: l.length, pct: l.length ? (100 * n) / l.length : null }; };

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
    <header class="page-top"><p class="eyebrow">Maps · objectives · appearance</p><h1>Know every <em>battleground</em></h1><p>Official map list and screenshots, how each mode is scored, and hero performance per map. Map appearance shares come only from matches you record yourself.</p></header>
    <div class="toolbar"><span id="qTabs"></span><label class="field">${icon('i-search')}<input id="mapQ" placeholder="Search maps…" value="${esc(ui.q)}" aria-label="Search maps"></label>
      <label class="sel"><span>Mode</span><select id="mapMode"><option value="">All modes</option>${modes.map(k => `<option value="${esc(k)}" ${ui.mode === k ? 'selected' : ''}>${esc(gm[k]?.name || md.mechanics[k]?.name || k)}</option>`).join('')}</select></label><span class="count" id="mapCount"></span></div>
    <div class="two wide-left">
      <section class="panel" id="sharePanel"></section>
      <section class="panel" id="logPanel"></section>
    </div>
    <div class="map-grid" id="mapGrid"></div>
    <p class="source-note">Map list and screenshots: OverFast API /maps (Blizzard imagery), fetched ${esc(new Date(md.fetchedAt).toLocaleString())}${md.stale ? ' — saved copy, live refresh failed' : ''}.</p></div>`;

  const draw = () => {
    const ledger = readLedger();
    $('#qTabs').innerHTML = queueTabs(ui.queue);
    const q = ui.q.trim().toLowerCase();
    const shown = md.data.filter(m => (!ui.mode || m.gamemodes.includes(ui.mode)) && (!q || m.name.toLowerCase().includes(q)));
    $('#mapCount').textContent = `${shown.length} maps`;
    $('#mapGrid').innerHTML = shown.length ? shown.map(m => {
      const s = share(ledger, ui.queue, m.key); const mode = modeOf(m, md);
      return `<a class="map-card" href="#/maps/${esc(m.key)}?queue=${ui.queue}">${mapImage(m.key, m.name, 'map-card-img')}<span class="map-meta"><span><b>${esc(m.name)}</b><small>${esc(m.location)}${s.total ? ` · your share ${s.pct.toFixed(1)}%` : ''}</small></span><span class="tag">${esc(gm[mode]?.name || md.mechanics[mode]?.name || mode)}</span></span></a>`;
    }).join('') : emptyBox('No maps match', 'Try another search or mode.');
    // personal appearance shares
    const own = ledger.filter(x => x.queue === ui.queue);
    const counts = {}; own.forEach(x => { counts[x.map] = (counts[x.map] || 0) + 1; });
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    $('#sharePanel').innerHTML = `<header class="panel-head"><h2>${icon('i-map')}Map appearance<small>— ${esc(QUEUE_SHORT[ui.queue])}</small></h2><span class="badge">PERSONAL SAMPLE</span></header>
      <div class="prose"><p>Share of <b>your recorded ${esc(QUEUE_SHORT[ui.queue])} matches</b> played on each map (n = ${own.length}). This is not Blizzard-wide popularity — Blizzard does not publish map appearance rates.</p>
      ${ranked.length ? `<div class="bars">${ranked.map(([k, c]) => { const m = md.data.find(x => x.key === k); return `<a class="bar-row" href="#/maps/${esc(k)}?queue=${ui.queue}"><span>${esc(m?.name || k)}</span><span class="track"><i style="width:${(c / own.length) * 100}%"></i></span><b>${((c / own.length) * 100).toFixed(1)}%</b><small>${c}/${own.length}</small></a>`; }).join('')}</div>` : emptyBox('No matches recorded yet', 'Log real matches on the right. Each queue keeps its own sample.')}</div>`;
    $('#logPanel').innerHTML = `<header class="panel-head"><h2>${icon('i-clock')}Record a match</h2></header><form class="prose ledger" id="ledgerForm">
      <p>Saved only in this browser, under <b>${esc(QUEUE_NAME[ui.queue])}</b>.</p>
      <label class="sel"><span>Map</span><select id="lgMap">${md.data.filter(m => m.gamemodes.some(g => md.mechanics[g])).map(m => `<option value="${esc(m.key)}">${esc(m.name)}</option>`).join('')}</select></label>
      <label class="sel"><span>Result</span><select id="lgRes"><option value="win">Win</option><option value="loss">Loss</option><option value="draw">Draw</option></select></label>
      <div class="cta"><button class="btn sm primary">Log match</button>${own.length ? '<button type="button" class="btn sm" data-act="undo">Undo last</button><button type="button" class="btn sm" data-act="csv">Export CSV</button>' : ''}</div></form>`;
  };
  draw();
  main.addEventListener('input', e => { if (e.target.id === 'mapQ') { ui.q = e.target.value; const pos = e.target.selectionStart; draw(); const f = $('#mapQ'); f.focus(); f.setSelectionRange(pos, pos); } }, { signal });
  main.addEventListener('change', e => { if (e.target.id === 'mapMode') { ui.mode = e.target.value; draw(); } }, { signal });
  main.addEventListener('submit', e => {
    if (e.target.id !== 'ledgerForm') return; e.preventDefault();
    const l = readLedger(); l.push({ date: new Date().toISOString(), queue: ui.queue, map: $('#lgMap').value, result: $('#lgRes').value }); saveLedger(l);
    toast('Match logged'); draw();
  }, { signal });
  main.addEventListener('click', e => {
    const qb = e.target.closest('[data-queue]'); if (qb) { ui.queue = qb.dataset.queue; return draw(); }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const l = readLedger();
    if (a.dataset.act === 'undo') { const i = l.map(x => x.queue).lastIndexOf(ui.queue); if (i >= 0) { l.splice(i, 1); saveLedger(l); draw(); } }
    if (a.dataset.act === 'csv') {
      const csv = [['date', 'queue', 'map', 'result'], ...l.map(x => [x.date, x.queue, x.map, x.result])].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); el.download = 'overscope-matches.csv'; el.click();
    }
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
    </div>
    <section class="panel" id="mdShare"></section></div>`;

  const drawHeroes = async () => {
    const el = $('#mdHeroes');
    el.innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Hero performance on ${esc(m.name)}</h2></header><div class="toolbar tight">${queueTabs(ui.queue)}</div><div id="mdOut">${loadingBox(5)}</div>`;
    if (ui.queue === 'open') { $('#mdOut').innerHTML = openQueueUnavailable(); return; }
    try {
      const s = await api(statsPath({ queue: ui.queue, map: m.key, division: '' }));
      const rows = [...s.rows].sort((a, b) => b.pickrate - a.pickrate).slice(0, 10);
      $('#mdOut').innerHTML = rows.length ? `<div class="table mini-table"><div class="tr th"><span>#</span><span>Hero</span><span>Pick on map</span><span>Win on map</span></div>${rows.map((r, i) => `<div class="tr hero-row" tabindex="0" data-hero="${esc(r.hero)}"><span class="rank">${i + 1}</span><span class="who">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(heroInfo(r.hero).name)}</b><small>${roleIcon(heroInfo(r.hero).role)}${esc(ROLE_NAME[heroInfo(r.hero).role] || '')}</small></span></span><span class="num"><b>${pct(r.pickrate)}</b></span><span class="num"><b>${pct(r.winrate)}</b></span></div>`).join('')}</div>
        <p class="source-note">Official hero rates <b>while playing on ${esc(m.name)}</b> · ${esc(QUEUE_NAME[ui.queue])} · ${esc(REGION_NAME[prefs.region])} · ${prefs.platform.toUpperCase()} · all ranks · fetched ${esc(new Date(s.source.fetchedAt).toLocaleString())}. These are not map appearance rates.</p>`
        : emptyBox('No published data for this map', 'The official table has no hero rates for this map with these filters (common for non-competitive maps).');
    } catch (e) { $('#mdOut').innerHTML = errorBox(e); }
  };
  const drawShare = () => {
    const s = share(readLedger(), ui.queue, m.key);
    $('#mdShare').innerHTML = `<header class="panel-head"><h2>${icon('i-map')}Map appearance<small>— ${esc(QUEUE_SHORT[ui.queue])}</small></h2><span class="badge">PERSONAL SAMPLE</span></header><div class="prose">
      <p>${s.total ? `<b>${s.pct.toFixed(1)}%</b> of your recorded ${esc(QUEUE_SHORT[ui.queue])} matches (${s.n} of ${s.total}) were on ${esc(m.name)}.` : `You have not recorded any ${esc(QUEUE_SHORT[ui.queue])} matches yet.`} Global map appearance rates are not published by Blizzard, so none are shown.</p>
      <div class="cta"><button class="btn sm primary" data-log="win">Log a win here</button><button class="btn sm" data-log="loss">Log a loss</button><button class="btn sm" data-log="draw">Log a draw</button><a class="btn sm ghost" href="#/maps?queue=${ui.queue}">All recorded matches</a></div></div>`;
  };
  drawHeroes(); drawShare();
  main.addEventListener('click', e => {
    const qb = e.target.closest('[data-queue]'); if (qb) { ui.queue = qb.dataset.queue; drawHeroes(); drawShare(); return; }
    const lg = e.target.closest('[data-log]');
    if (lg) { const l = readLedger(); l.push({ date: new Date().toISOString(), queue: ui.queue, map: m.key, result: lg.dataset.log }); saveLedger(l); toast(`Logged ${lg.dataset.log} on ${m.name} (${QUEUE_SHORT[ui.queue]})`); drawShare(); return; }
    const h = e.target.closest('[data-hero]'); if (h) go('#/heroes/' + h.dataset.hero);
  }, { signal });
}
