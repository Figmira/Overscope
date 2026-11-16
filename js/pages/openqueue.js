// Competitive · Open Queue — built from public player profiles.
// Blizzard publishes no all-player hero rates for Open Queue, but every public career profile
// carries the player's Open Queue rank and their Competitive hero stats for the season.
import { $, esc, pct, api, heroInfo, heroPortrait, icon, errorBox, loadingBox, emptyBox, relay, cap, favorites, INPUT_NAME } from '../lib.js';
import { go } from '../app.js';

const hours = s => (s == null ? '—' : s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min');
const per10 = (h, k) => (h.average?.[k] ?? null); // Blizzard's averages are per 10 minutes
const n1 = v => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const rankText = r => (r ? `${cap(r.division)} ${r.tier ?? ''}`.trim() : 'Unranked / not placed');
const rankImg = r => (r?.rankIcon ? `<img class="os-img rank-img" src="${esc(relay(r.rankIcon))}" alt="${esc(r.division)} rank icon" width="48" height="48" data-fallback="${esc(r.division)}" data-role="none">` : '<span class="rank-ph"></span>');

export async function render({ main, route }) {
  const id = route.query.get('id') || '';
  main.innerHTML = `
    <header class="page-top"><p class="eyebrow">Competitive · Open Queue</p><h1>Open Queue <em>player stats</em></h1>
      <p>Look up any public player to see their Open Queue rank and the heroes they play in Competitive this season.</p></header>
    <form id="oqForm" class="oq-search" role="search"><input id="oqInput" type="search" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="BattleTag, e.g. Name#1234" aria-label="BattleTag" value="${esc(id.replace(/-(\d+)$/, '#$1'))}"><button class="btn">${icon('i-search')}Look up</button></form>
    <div id="oqPlayer"></div>
    <div id="oqFavs"></div>
    <p class="source-note">From each player's public Blizzard career profile (via OverFast). Blizzard does not publish Open Queue hero pick, win or ban rates across all players, so this section shows player data only. Blizzard also combines Role Queue and Open Queue games in a player's Competitive hero stats.</p>`;
  $('#oqForm').addEventListener('submit', e => {
    e.preventDefault();
    const tag = $('#oqInput').value.trim().replace('#', '-');
    if (!/^.+-\d{3,6}$/.test(tag)) { $('#oqPlayer').innerHTML = emptyBox('Enter a full BattleTag', 'Use the name and number, like Name#1234.'); return; }
    $('#oqInput').blur();
    go('#/open-queue?id=' + encodeURIComponent(tag));
  });
  if (id) await player(id); else $('#oqPlayer').innerHTML = '';
  await favs(id);
}

async function player(id) {
  const el = $('#oqPlayer');
  el.innerHTML = loadingBox(4);
  let p;
  try { p = (await api('/api/players/' + encodeURIComponent(id))).data; }
  catch (e) {
    el.innerHTML = e.status === 404 ? emptyBox('No public profile for this BattleTag', 'Blizzard has no public career profile for it. The profile may be private, or the name or number may be different.') : errorBox(e);
    return;
  }
  const plats = p.compPlatforms || [];
  if (!plats.length) {
    el.innerHTML = playerHead(p) + emptyBox('No Competitive season on record', 'This profile has no current-season Competitive record, so there is no Open Queue rank to show.');
    return;
  }
  el.innerHTML = playerHead(p) + plats.map(pl => {
    const c = p.competitive[pl]; const s = p.statsByPlatform[pl];
    const hasRoleRank = ['tank', 'damage', 'support'].some(r => c[r]);
    const heroes = (s?.heroes || []).filter(h => h.gamesPlayed).slice(0, 12);
    const note = hasRoleRank
      ? 'This player also has a Role Queue rank this season, so these hero numbers include both queues.'
      : 'This player has no Role Queue rank this season, so these games are most likely Open Queue.';
    return `<section class="panel">
      <header class="panel-head"><h2>${icon('i-laurel')}Open Queue<small>— season ${esc(c.season ?? '')} · ${esc(INPUT_NAME[pl])}</small></h2></header>
      <div class="ranks oq-ranks"><div class="rank-cell">${rankImg(c.open)}<span><small>Open Queue rank</small><b>${esc(rankText(c.open))}</b></span></div>
        ${s?.general ? `<div class="rank-cell"><span><small>Competitive games</small><b>${esc(n1(s.general.gamesPlayed))}</b></span></div><div class="rank-cell"><span><small>Win rate</small><b>${s.general.gamesPlayed ? pct(s.general.winrate) : '—'}</b></span></div><div class="rank-cell"><span><small>Time played</small><b>${hours(s.general.timePlayed)}</b></span></div>` : ''}</div>
      ${s?.error ? errorBox({ message: s.error }) : heroes.length ? `<div class="table mini-table oq-table"><div class="tr th"><span>Hero</span><span>Games</span><span>Win rate</span><span>Time</span><span>Elims/10</span><span>Deaths/10</span></div>
        ${heroes.map(h => `<a class="tr" href="#/heroes/${esc(h.hero)}"><span class="who">${heroPortrait(h.hero, 'portrait')}<b>${esc(heroInfo(h.hero).name)}</b></span><span>${n1(h.gamesPlayed)}</span><span>${h.gamesPlayed ? pct(h.winrate) : '—'}</span><span>${hours(h.timePlayed)}</span><span>${n1(per10(h, 'eliminations'))}</span><span>${n1(per10(h, 'deaths'))}</span></a>`).join('')}</div>` : emptyBox('No hero games yet', 'No Competitive hero games are on record this season.')}
      <p class="source-note">${esc(note)}</p></section>`;
  }).join('');
}

const playerHead = p => `<section class="panel oq-head"><a class="oq-player" href="#/players/${encodeURIComponent(p.id)}">${p.avatar ? `<img class="avatar sm" src="${esc(relay(p.avatar))}" alt="" width="48" height="48">` : '<span class="avatar sm avatar-ph"></span>'}<span><b>${esc(p.username || p.id)}</b><small class="muted">${esc(p.id.replace(/-(\d+)$/, '#$1'))}</small></span><span class="go">Full profile ${icon('i-arrow')}</span></a></section>`;

async function favs(currentId) {
  const list = favorites().players.filter(f => f.id !== currentId).slice(0, 6);
  const el = $('#oqFavs');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<section class="panel"><header class="panel-head"><h2>${icon('i-user')}Your saved players</h2></header><div class="oq-favs" id="oqFavList">${list.map(f => `<a class="oq-fav" href="#/open-queue?id=${encodeURIComponent(f.id)}" data-id="${esc(f.id)}"><b>${esc(f.name || f.id.replace(/-\d+$/, ''))}</b><small class="muted">Loading rank…</small></a>`).join('')}</div></section>`;
  await Promise.all(list.map(async f => {
    const cell = el.querySelector(`[data-id="${CSS.escape(f.id)}"] small`);
    try {
      const p = (await api('/api/players/' + encodeURIComponent(f.id))).data;
      const ranks = (p.compPlatforms || []).map(pl => `${INPUT_NAME[pl]}: ${rankText(p.competitive[pl].open)}`);
      if (cell) cell.textContent = ranks.length ? ranks.join(' · ') : 'No Competitive season on record';
    } catch { if (cell) cell.textContent = 'Profile unavailable'; }
  }));
}
