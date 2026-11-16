// Player vs player: head to head (hero / role / overall), compared with the average player,
// shared-hero scoreboard and duo fit. All rules live in ../h2h.js.
import { $, esc, api, qs, prefs, heroInfo, heroPortrait, icon, emptyBox, ROLE_NAME, INPUT_NAME, REGION_NAME, RANK_LABEL, seasonName } from '../lib.js';
import { RULES, GROUPS, ROLE_FOCUS, careerMetrics, summaryMetrics, compareMetrics, summaryParts, formatValue, records, fingerprint, scoreboard, bestHero, duoFit } from '../h2h.js';

const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const hours = s => (s == null ? '—' : s >= 3600 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 60) + ' min');
const wr = v => (v == null ? '—' : Number.isInteger(v) ? v + '%' : v.toFixed(1) + '%');
const state = { mode: 'competitive', by: 'hero', key: '' };
let A, B, seq = 0;

// Each player's whole career (every hero) for one mode and platform: one request, cached.
const careers = new Map();
function careerAll(p, mode) {
  const plat = p.stats[mode]?.platform || 'pc';
  const k = `${p.id}|${mode}|${plat}`;
  if (!careers.has(k)) careers.set(k, api(`/api/players/${encodeURIComponent(p.id)}/career?` + qs({ gamemode: mode, platform: plat })).then(r => r.data || {}, () => ({})));
  return careers.get(k);
}
const averages = new Map();
function averageRows(mode, plat, division) {
  const k = `${mode}|${plat}|${prefs.region}|${division || 'all'}`;
  if (!averages.has(k)) {
    averages.set(k, (mode === 'competitive' && division
      ? api('/api/stats/by-rank?' + qs({ platform: plat, region: prefs.region })).then(r => r.divisions?.[division] || [])
      : api('/api/stats?' + qs({ queue: mode, platform: plat, region: prefs.region })).then(r => r.rows || [])).catch(() => []));
  }
  return averages.get(k);
}

export function renderPvp(a, b, root) {
  A = a; B = b; state.key = '';
  root.innerHTML = `<section class="panel" id="h2h"></section><section class="panel" id="h2hBoard"></section><section class="panel" id="h2hDuo"></section>`;
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-h2h]');
    if (t) { const [k, v] = t.dataset.h2h.split(':'); state[k] = v; if (k !== 'key') state.key = ''; draw(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { state.by = 'hero'; state.key = pick.dataset.pick; draw(); $('#h2h').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  root.addEventListener('change', e => { if (e.target.id === 'h2hKey') { state.key = e.target.value; draw(); } });
  draw();
}

// ---------- building the two metric sets for the current scope ----------
function scope() {
  const m = state.mode, sA = A.stats[m], sB = B.stats[m];
  const heroMap = s => new Map((s?.heroes || []).map(h => [h.hero, h]));
  const hA = heroMap(sA), hB = heroMap(sB);
  const heroKeys = [...new Set([...hA.keys(), ...hB.keys()])]
    .sort((x, y) => ((hB.has(y) && hA.has(y)) - (hB.has(x) && hA.has(x))) || ((hA.get(y)?.timePlayed || 0) + (hB.get(y)?.timePlayed || 0)) - ((hA.get(x)?.timePlayed || 0) + (hB.get(x)?.timePlayed || 0)));
  const roleKeys = ['tank', 'damage', 'support'].filter(r => sA?.roles?.[r] || sB?.roles?.[r]);
  if (state.by === 'hero' && !heroKeys.includes(state.key)) state.key = heroKeys[0] || '';
  if (state.by === 'role' && !roleKeys.includes(state.key)) state.key = roleKeys[0] || '';
  const block = s => (state.by === 'overall' ? s?.general : state.by === 'role' ? s?.roles?.[state.key] : s?.heroes?.find(h => h.hero === state.key)) || null;
  const role = state.by === 'hero' ? heroInfo(state.key).role : state.by === 'role' ? state.key : '';
  const what = state.by === 'overall' ? 'all heroes' : state.by === 'role' ? ROLE_NAME[state.key] || '' : heroInfo(state.key).name;
  return { m, sA, sB, hA, hB, heroKeys, roleKeys, a: block(sA), b: block(sB), role, what };
}
function metricsFor(sc, which, career) {
  const blockv = which === 'a' ? sc.a : sc.b;
  let groups = null;
  if (career) groups = state.by === 'hero' ? career[state.key] : state.by === 'overall' ? career['all-heroes'] : null;
  const m = groups?.length ? careerMetrics(groups, sc.role) : summaryMetrics(blockv, sc.role);
  // Games and win rate always come from the same summary the hero list uses (Blizzard's Win Percentage).
  m.__games = blockv?.gamesPlayed ?? null;
  if (m.win_percentage && blockv?.winrate != null) m.win_percentage = { ...m.win_percentage, value: blockv.winrate };
  return m;
}

// ---------- drawing ----------
async function draw() {
  const my = ++seq;
  const sc = scope();
  drawHead2Head(sc, null, null);
  drawBoard(sc, null, null);
  drawDuo(sc);
  const [cA, cB] = await Promise.all([careerAll(A, sc.m), careerAll(B, sc.m)]);
  if (my !== seq) return;
  drawHead2Head(sc, cA, cB);
  drawBoard(sc, cA, cB);
  if (state.by === 'hero' && state.key) drawVsAverage(sc, my);
}

const seg = (k, opts) => `<div class="seg sm">${opts.map(([v, t]) => `<button class="${state[k] === v ? 'on' : ''}" data-h2h="${k}:${v}">${t}</button>`).join('')}</div>`;

function drawHead2Head(sc, cA, cB) {
  const box = $('#h2h'); if (!box) return;
  const { m, sA, sB, hA, hB, heroKeys, roleKeys } = sc;
  const keySel = state.by === 'hero' ? (heroKeys.length ? `<label class="sel"><span>Hero</span><select id="h2hKey">${heroKeys.map(k => `<option value="${esc(k)}" ${k === state.key ? 'selected' : ''}>${esc(heroInfo(k).name)}${hA.has(k) && hB.has(k) ? ' · both' : hA.has(k) ? ' · ' + esc(A.username) + ' only' : ' · ' + esc(B.username) + ' only'}</option>`).join('')}</select></label>` : '')
    : state.by === 'role' ? seg('key', roleKeys.map(r => [r, ROLE_NAME[r]])) : '';
  const plats = `${esc(INPUT_NAME[sA?.platform] || '—')} vs ${esc(INPUT_NAME[sB?.platform] || '—')}`;
  const scopeNote = m === 'competitive' ? `Competitive ${esc(seasonName((A.competitive[sA?.platform] || {}).season) || 'this season')} (${plats})` : `Quick Play lifetime (${plats})`;
  const head = `<header class="panel-head"><h2>${icon('i-group')}Head to head</h2><small class="muted">${esc(sc.what)} · ${scopeNote}</small></header>
    <div class="toolbar h2h-tools">${seg('mode', [['competitive', 'Competitive'], ['quickplay', 'Quick Play']])}${seg('by', [['hero', 'Hero'], ['role', 'Role'], ['overall', 'Overall']])}${keySel}</div>`;
  if ((!sA || sA.error || sA.noSeason) && (!sB || sB.error || sB.noSeason)) { box.innerHTML = head + emptyBox('No data for this mode', m === 'competitive' ? 'Neither player has a Competitive season on record.' : 'Neither profile has Quick Play stats.'); return; }
  const loading = !cA;
  const ma = metricsFor(sc, 'a', cA), mb = metricsFor(sc, 'b', cB);
  const res = compareMetrics(ma, mb);
  const ga = sc.a?.gamesPlayed ?? 0, gb = sc.b?.gamesPlayed ?? 0;
  const verdict = !res.enough ? `<p class="h2h-note">Not enough games to call it: ${esc(A.username)} ${num(ga)}, ${esc(B.username)} ${num(gb)} on ${esc(sc.what)}. Calls start once both have ${RULES.minGames}+ games.</p>`
    : `<p class="h2h-verdict">${res.winner === 'close' ? `Too close to call on ${esc(sc.what)} — weighted score ${res.scoreA}–${res.scoreB}` : `<b>${esc(res.winner === 'a' ? A.username : B.username)}</b> performs better on ${esc(sc.what)} — weighted score ${Math.max(res.scoreA, res.scoreB)}–${Math.min(res.scoreA, res.scoreB)}`}</p>`;
  const parts = summaryParts(res, A.username, B.username, sc.what, sc.role ? ROLE_NAME[sc.role].toLowerCase() : '');
  const focusList = sc.role ? (ROLE_FOCUS[sc.role] || []).map(k => k.replace(/_avg_per_10_min$/, '').replace(/_/g, ' ').replace('obj ', 'objective ').replace(' done', '')).join(' and ') : '';
  // records: hero or overall only (Blizzard keeps no per-role records)
  const recGroups = c => (!c ? null : state.by === 'hero' ? c[state.key] : state.by === 'overall' ? c['all-heroes'] : null);
  const rA = records(recGroups(cA) || []), rB = records(recGroups(cB) || []);
  const recKeys = [...new Set([...Object.keys(rA), ...Object.keys(rB)])];
  const fp = fingerprint(ma, mb);
  box.innerHTML = head + verdict + `
    <div id="vsAvg"></div>
    <div class="gap-table">
      <div class="gap-row th"><span class="va">${esc(A.username)}</span><span class="gap-mid">${state.by === 'hero' && state.key ? heroPortrait(state.key, 'portrait') : ''}</span><span class="vb">${esc(B.username)}</span></div>
      <div class="gap-row plain"><span class="va">${num(ga)}</span><span class="gap-mid"><span class="gap-label">Games</span></span><span class="vb">${num(gb)}</span></div>
      <div class="gap-row plain"><span class="va">${sc.a ? hours(sc.a.timePlayed) : '—'}</span><span class="gap-mid"><span class="gap-label">Time played</span></span><span class="vb">${sc.b ? hours(sc.b.timePlayed) : '—'}</span></div>
      ${gapRows(res)}
    </div>
    ${loading && state.by !== 'role' ? `<p class="source-note">Loading ${esc(sc.what)} career stats…</p>` : ''}
    <section class="h2h-summary"><h3>${icon('i-info')}OverScope analysis</h3>
      <p class="h2h-head">${esc(parts.headline)}</p>
      ${parts.points.length ? `<ul>${parts.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <details class="how"><summary>How this is decided</summary><p class="muted small">Only rates are compared (per 10 minutes, percentages, per life), never totals or records. A stat counts as a lead only if the gap is 5% or more (2 points for percentages); smaller gaps are “even”. Win rate, hero ability stats, survival${focusList ? ` and the role focus for a ${esc(ROLE_NAME[sc.role].toLowerCase())} (${esc(focusList)})` : ''} count double. ${sc.role && sc.role !== 'support' ? 'Healing is not judged for tank or damage heroes. ' : ''}If the weighted scores are within 1, it's too close to call. Both players need ${RULES.minGames}+ games. Win rates are Blizzard's own Win Percentage.</p></details>
    </section>
    ${fp.length >= 3 ? `<section class="h2h-sub"><h3>${icon('i-chart')}Play-style fingerprint</h3>${radar(fp)}<p class="muted small">Each axis is scaled to whichever player is stronger on it (outer edge = the stronger one). Survival uses eliminations per life.</p></section>` : ''}
    ${state.by === 'role' ? '' : recKeys.length ? `<section class="h2h-sub"><h3>${icon('i-laurel')}Best-game records</h3><div class="table vs-table rec-table">${recKeys.map((k, i) => {
      const r = rA[k] || rB[k], va = rA[k]?.value, vb = rB[k]?.value;
      const w = va != null && vb != null && va !== vb ? (va > vb ? 'a' : 'b') : '';
      const f = v => (v == null ? '—' : r.time ? hours(v) : r.pct ? v + '%' : num(v));
      return `${i === 8 ? `</div><details class="more-rec"><summary>Show all ${recKeys.length} records</summary><div class="table vs-table rec-table">` : ''}<div class="tr"><span class="${w === 'a' ? 'win' : ''}">${f(va)}</span><span class="mid">${esc(r.label)}</span><span class="${w === 'b' ? 'win b' : ''}">${f(vb)}</span></div>`;
    }).join('')}</div>${recKeys.length > 8 ? '</details>' : ''}<p class="muted small">Personal bests are shown for fun and never count toward who performs better.</p></section>` : loading ? '' : ''}`;
}

function gapRows(res) {
  let last = '';
  return res.rows.map(r => {
    const g = r.group !== last ? `<div class="gap-group">${esc(GROUPS[r.group].label)}${GROUPS[r.group].weight > 1 ? ' <small>×2</small>' : ''}</div>` : '';
    last = r.group;
    const size = Math.max(8, Math.min(100, (r.rel / 0.5) * 100));
    const bar = r.w === 'a' ? `<i class="gap-a" style="width:${size}%"></i>` : r.w === 'b' ? `<i class="gap-b" style="width:${size}%"></i>` : '';
    return g + `<div class="gap-row ${r.w}"><span class="va ${r.w === 'a' ? 'win' : ''}">${formatValue(r, r.va)}</span>
      <span class="gap-mid"><span class="gap-label">${esc(r.label)}${r.w === 'even' ? ' <small class="even-tag">even</small>' : ''}</span>
        <span class="gap-track"><span class="half left">${r.w === 'a' ? bar : ''}</span><span class="half right">${r.w === 'b' ? bar : ''}</span></span></span>
      <span class="vb ${r.w === 'b' ? 'win' : ''}">${formatValue(r, r.vb)}</span></div>`;
  }).join('');
}

function radar(axes) {
  const S = 280, c = S / 2, R = 92, n = axes.length;
  const pt = (i, f) => { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + Math.cos(ang) * R * f, c + Math.sin(ang) * R * f]; };
  const poly = key => axes.map((x, i) => pt(i, Math.max(0.04, x[key])).map(v => v.toFixed(1)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="ring" points="${axes.map((_, i) => pt(i, f).join(',')).join(' ')}"/>`).join('');
  const spokes = axes.map((_, i) => `<line class="spoke" x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}"/>`).join('');
  const labels = axes.map((x, i) => { const [lx, ly] = pt(i, 1.2); return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'}" dominant-baseline="middle">${esc(x.label)}</text>`; }).join('');
  return `<div class="radar-wrap"><svg class="radar" viewBox="-40 0 ${S + 80} ${S}" role="img" aria-label="Play-style comparison">${rings}${spokes}
    <polygon class="pa" points="${poly('a')}"/><polygon class="pb" points="${poly('b')}"/>${labels}</svg>
    <div class="legend"><span><i class="sw a"></i>${esc(A.username)}</span><span><i class="sw b"></i>${esc(B.username)}</span></div></div>`;
}

async function drawVsAverage(sc, my) {
  const el = $('#vsAvg'); if (!el) return;
  const hero = state.key, role = heroInfo(hero).role, m = sc.m;
  const line = async (p, blockv) => {
    if (!blockv?.gamesPlayed) return null;
    const plat = p.stats[m]?.platform || 'pc';
    let division = '', rankText = '';
    if (m === 'competitive') {
      const c = p.competitive[plat] || {};
      const r = c[role] || c.open;
      if (r?.division) { division = r.division === 'champion' ? 'grandmaster' : r.division; rankText = `${RANK_LABEL(division)}${c[role] ? '' : ' (Open Queue rank)'}`; }
    }
    const rows = await averageRows(m, plat, division);
    const avg = rows.find(x => x.hero === hero)?.winrate;
    if (avg == null) return null;
    const diff = blockv.winrate - avg;
    return { p, mine: blockv.winrate, avg, diff, label: m === 'competitive' ? (rankText ? `${rankText} average` : 'all-ranks average') : 'Quick Play average', plat };
  };
  const out = (await Promise.all([line(A, sc.a), line(B, sc.b)])).filter(Boolean);
  if (my !== seq || !out.length) return;
  el.innerHTML = `<div class="vs-avg">${out.map(x => `<div class="vs-avg-row"><b>${esc(x.p.username)}</b><span>${wr(x.mine)} on ${esc(heroInfo(hero).name)}</span><span class="muted">vs ${esc(x.label)} ${x.avg.toFixed(1)}%</span><span class="delta ${x.diff >= 0 ? 'up' : 'down'}">${x.diff >= 0 ? '+' : '−'}${Math.abs(x.diff).toFixed(1)} pts</span></div>`).join('')}
    <p class="muted small">Average = Blizzard's win rate for ${esc(heroInfo(hero).name)} across all ${m === 'competitive' ? 'players at that rank' : 'Quick Play players'} (${esc(REGION_NAME[prefs.region] || prefs.region)}, same platform, current patch). Blizzard publishes averages for win rate only, not for other stats.</p></div>`;
}

function drawBoard(sc, cA, cB) {
  const box = $('#h2hBoard'); if (!box) return;
  const hA = sc.sA?.heroes || [], hB = sc.sB?.heroes || [];
  const head = `<header class="panel-head"><h2>${icon('i-mask')}Shared heroes</h2><small class="muted">${state.mode === 'competitive' ? 'Competitive' : 'Quick Play'} · heroes both have ${RULES.minGames}+ games on</small></header>`;
  if (!cA) { box.innerHTML = head + '<p class="source-note" style="margin:12px 14px">Comparing every shared hero…</p>'; return; }
  const sb = scoreboard(hA, hB, cA, cB, k => heroInfo(k).role);
  const best = [[A, bestHero(hA)], [B, bestHero(hB)]];
  if (!sb.rows.length) { box.innerHTML = head + emptyBox('No shared heroes yet', `There is no hero both players have ${RULES.minGames}+ games on in this mode.`); return; }
  const res = r => (r.winner === 'a' ? `<span class="res a">${esc(A.username)}</span>` : r.winner === 'b' ? `<span class="res b">${esc(B.username)}</span>` : '<span class="res close">Too close</span>');
  box.innerHTML = head + `<p class="h2h-verdict">${sb.winsA === sb.winsB ? `Even across shared heroes: ${sb.winsA}–${sb.winsB}` : `<b>${esc(sb.winsA > sb.winsB ? A.username : B.username)}</b> performs better on ${Math.max(sb.winsA, sb.winsB)} of ${sb.rows.length} shared heroes`}${sb.close ? ` · ${sb.close} too close to call` : ''}</p>
    <div class="table board-table"><div class="tr th"><span>Hero</span><span>Games</span><span>Better</span><span>Score</span></div>
    ${sb.rows.map(r => `<button class="tr" data-pick="${esc(r.hero)}"><span class="who">${heroPortrait(r.hero, 'portrait')}<b>${esc(heroInfo(r.hero).name)}</b></span><span>${num(r.gamesA)} · ${num(r.gamesB)}</span>${res(r)}<span>${r.scoreA}–${r.scoreB}</span></button>`).join('')}</div>
    <p class="best-heroes">${best.map(([p, h]) => `<span><b>${esc(p.username)}'s best hero:</b> ${h ? `${esc(heroInfo(h.hero).name)} — ${wr(h.winrate)} in ${num(h.gamesPlayed)} games` : 'no hero with 10+ games'}</span>`).join('')}</p>
    <p class="muted small">Each hero is judged with the same rules as Head to head. Tap a hero to see the full breakdown.</p>`;
}

function drawDuo(sc) {
  const box = $('#h2hDuo'); if (!box) return;
  const head = `<header class="panel-head"><h2>${icon('i-group')}Duo fit</h2><small class="muted">${state.mode === 'competitive' ? 'Competitive' : 'Quick Play'} · if you queue together</small></header>`;
  const opts = duoFit(sc.sA?.roles, sc.sB?.roles);
  if (!opts.length) { box.innerHTML = head + emptyBox('Not enough role games', `Each player needs ${RULES.duoMinGames}+ games on a role to suggest a split.`); return; }
  const top = (s, role) => (s?.heroes || []).filter(h => heroInfo(h.hero).role === role && h.gamesPlayed >= RULES.minGames).sort((a, b) => b.winrate - a.winrate || b.gamesPlayed - a.gamesPlayed).slice(0, 3);
  const o = opts[0];
  const side = (p, s, role, win, games) => `<div class="duo-side"><small>${esc(p.username)}</small><b>${esc(ROLE_NAME[role])}</b><span>${win.toFixed(1)}% win rate · ${num(games)} games</span>
    <div class="duo-heroes">${top(s, role).map(h => `<span>${heroPortrait(h.hero, 'portrait')}${esc(heroInfo(h.hero).name)} <small>${wr(h.winrate)}</small></span>`).join('') || '<small class="muted">No hero with 5+ games</small>'}</div></div>`;
  box.innerHTML = head + `<div class="duo">${side(A, sc.sA, o.roleA, o.winA, o.gamesA)}<span class="duo-plus">+</span>${side(B, sc.sB, o.roleB, o.winB, o.gamesB)}</div>
    ${opts.length > 1 ? `<p class="muted small duo-alt">Next best: ${opts.slice(1, 3).map(x => `${esc(A.username)} ${esc(ROLE_NAME[x.roleA])} + ${esc(B.username)} ${esc(ROLE_NAME[x.roleB])} (${x.winA.toFixed(0)}% / ${x.winB.toFixed(0)}%)`).join(' · ')}</p>` : ''}
    <p class="muted small duo-alt">Picks the pairing with the highest combined role win rate (${RULES.duoMinGames}+ games per role). Role Queue has one tank, so both players can't tank. Role win rates are wins ÷ games, because Blizzard publishes Win Percentage per hero only. Heroes shown are each player's best on that role.</p>`;
}
