// Tier list: heroes graded from Blizzard's official pick and win rates.
import { $, esc, pct, api, prefs, setPref, statsPath, heroInfo, heroPortrait, icon, roleIcon, roleTabs, errorBox, loadingBox, emptyBox, ROLE_NAME, QUEUE_NAME, REGION_NAME, queueTabs, filterSelects, sourceNote, openQueueUnavailable, cap , INPUT_NAME, INPUT_SHORT, RANK_LABEL, RANK_SHORT } from '../lib.js';
import { heroes as loadHeroes } from '../app.js';
import '../charts.js'; // hover tooltips
import { computeTiers, groupTiers, METHOD } from '../tiers.js';

const ui = { role: '' };

export async function render({ main, route, signal }) {
  const q = route.query.get('queue');
  if (['competitive', 'quickplay'].includes(q)) setPref('queue', q);
  const r = route.query.get('rank');
  if (r !== null && ['', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster'].includes(r)) setPref('division', r);
  await loadHeroes().catch(() => {});
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Tier list · official rates</p><h1>Hero <em>tier list</em></h1><p>Every hero graded S to D from Blizzard's own pick and win rates for the queue, platform, region and rank you choose. No opinions, no invented numbers — the method is shown below.</p></header>
    <div class="toolbar" id="tlTools"></div>
    <div class="toolbar" id="tlRoles"></div>
    <div class="two wide-left"><section class="panel tier-panel" id="tlOut">${loadingBox(8)}</section>
      <div class="col"><section class="panel"><div class="prose"><h3>How tiers are worked out</h3><p>${esc(METHOD)}</p><p class="muted">Hover or focus a hero to see its numbers. A tier describes results across all players at that rank — not whether a hero is right for you.</p></div></section><section class="panel" id="tlShare"></section></div></div></div>`;
  main.addEventListener('click', e => {
    const qb = e.target.closest('[data-queue]'); if (qb) { setPref('queue', qb.dataset.queue); return draw(); }
    const rb = e.target.closest('[data-role]'); if (rb) { ui.role = rb.dataset.role; return draw(); }
  }, { signal });
  main.addEventListener('change', e => { const p = e.target.dataset.pref; if (p) { setPref(p, e.target.value); draw(); } }, { signal });
  draw();
}

async function draw() {
  $('#tlTools').innerHTML = queueTabs(prefs.queue) + filterSelects();
  $('#tlRoles').innerHTML = roleTabs(ui.role);
  const out = $('#tlOut');
  out.innerHTML = loadingBox(8);
  let s;
  try { s = await api(statsPath({ role: '', map: '' })); } catch (e) { out.innerHTML = errorBox(e); return; }
  if (!s.available) { out.innerHTML = openQueueUnavailable(s.reason); $('#tlShare').innerHTML = ''; return; }
  const scored = computeTiers(s.rows, k => heroInfo(k).role);
  if (!scored.length) { out.innerHTML = emptyBox('No data', 'The official table returned no heroes for these filters.'); return; }
  const rank = prefs.queue === 'competitive' ? (prefs.division ? RANK_LABEL(prefs.division) : 'All ranks') : '';
  const groups = groupTiers(scored).map(g => ({ ...g, heroes: g.heroes.filter(r => !ui.role || r.role === ui.role) }));
  const tile = r => {
    const h = heroInfo(r.hero);
    const tip = `<b>${esc(h.name)}</b> · ${esc(ROLE_NAME[r.role] || '')}<br>Win ${pct(r.winrate)} · Pick ${pct(r.pickrate)}${r.banrate != null ? ` · Ban ${pct(r.banrate)}` : ''}<br>Score ${r.score > 0 ? '+' : ''}${r.score.toFixed(2)} (win edge ${r.winEdge > 0 ? '+' : ''}${r.winEdge.toFixed(2)}, popularity ${r.popularity > 0 ? '+' : ''}${r.popularity.toFixed(2)})`;
    return `<a class="tier-hero role-${esc(r.role)}" href="#/heroes/${esc(r.hero)}" data-tip="${esc(tip)}" aria-label="${esc(h.name)}, ${esc(r.tier)} tier, win rate ${pct(r.winrate)}, pick rate ${pct(r.pickrate)}">${heroPortrait(r.hero, 'portrait')}<span><b>${esc(h.name)}</b><small>${roleIcon(r.role)}${pct(r.winrate)} win · ${pct(r.pickrate)} pick</small></span></a>`;
  };
  out.innerHTML = `<header class="panel-head"><h2>${icon('i-laurel')}Tier list<small>— ${esc(QUEUE_NAME[prefs.queue])}${rank ? ' · ' + esc(rank) : ''}</small></h2><small class="muted">${esc(REGION_NAME[prefs.region])} · ${esc(INPUT_NAME[prefs.platform])}</small></header>
    <div class="tiers">${groups.map(g => `<div class="tier-row t-${g.tier}"><div class="tier-badge"><b>${g.tier}</b><small>${esc(g.label)}</small></div><div class="tier-heroes">${g.heroes.length ? g.heroes.map(tile).join('') : '<span class="muted">None in this filter</span>'}</div></div>`).join('')}</div>
    ${sourceNote(s)}`;
  // Shareable, Google-visible version (generated daily for PC · Americas · Role Queue)
  const slug = prefs.queue === 'competitive' ? (prefs.division || 'all-ranks') : '';
  $('#tlShare').innerHTML = slug && prefs.platform === 'pc' && prefs.region === 'americas'
    ? `<div class="prose"><h3>Share this tier list</h3><p>A shareable page with a preview card for Discord and X is published every day for this rank.</p><p><a class="btn sm" href="tier-list/${slug === 'all-ranks' ? '' : slug + '/'}">Open shareable page ${icon('i-arrow')}</a></p></div>`
    : `<div class="prose"><h3>Share this tier list</h3><p class="muted">Shareable pages are published for Competitive · Mouse &amp; Keyboard · Americas. Copy this page's address to share the current filters.</p></div>`;
}
