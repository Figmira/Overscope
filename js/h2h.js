// Head-to-head rules for Player vs Player. Pure functions, no page code, so the same
// rules apply everywhere and the unit tests can check them.
//
// Rules (agreed with the site owner):
//  - Only rates are compared (per 10 minutes, percentages, per life). Totals and
//    "best in a game" records are shown separately and never counted.
//  - Both players need 5+ games in what is compared, or no stat is called.
//  - "Even" band: percentages need a 2-point gap; everything else a 5% gap
//    (and at least 0.1 for small per-10 counts).
//  - Weights: win rate x2, hero ability stats x2, survival x2, the stats that matter most
//    for the hero's role x2 ("role focus"), everything else x1.
//  - Role-aware: healing is not judged for tank or damage heroes (it isn't their job).
//  - If the weighted scores are within 1 point, the verdict is "too close to call".

export const RULES = { minGames: 5, relBand: 0.05, pctBand: 2, minAbs: 0.1, closeScore: 1, duoMinGames: 10 };
export const GROUPS = {
  win: { label: 'Winning', weight: 2 },
  focus: { label: 'Role focus', weight: 2 },
  ability: { label: 'Hero abilities', weight: 2 },
  survival: { label: 'Survival', weight: 2 },
  impact: { label: 'Impact', weight: 1 },
  accuracy: { label: 'Accuracy', weight: 1 },
  objective: { label: 'Objective', weight: 1 },
};
const ORDER = Object.keys(GROUPS);

/** What matters most for each role. These stats move into the "Role focus" group (x2). */
export const ROLE_FOCUS = {
  tank: ['objective_time_avg_per_10_min', 'obj_contest_time_avg_per_10_min'],
  damage: ['final_blows_avg_per_10_min', 'solo_kills_avg_per_10_min'],
  support: ['healing_done_avg_per_10_min', 'assists_avg_per_10_min'],
};
const OFF_ROLE = { tank: ['healing_done_avg_per_10_min'], damage: ['healing_done_avg_per_10_min'], support: [] };

const pretty = k => {
  const s = k.replace(/_avg_per_10_min$/, '').replace(/_/g, ' ').replace(/\bobj\b/, 'objective').replace(/\bhero damage done\b/, 'hero damage').replace(/\bhealing done\b/, 'healing');
  return s[0].toUpperCase() + s.slice(1) + (k.endsWith('_avg_per_10_min') ? ' / 10 min' : '');
};
const isPct = k => /accuracy|percentage/.test(k);
const isLower = k => /deaths|damage_taken/.test(k);

function applyRole(out, role) {
  if (!role) return out;
  for (const k of OFF_ROLE[role] || []) delete out[k];
  for (const k of ROLE_FOCUS[role] || []) if (out[k]) out[k] = { ...out[k], group: 'focus' };
  return out;
}

/** Rate metrics from one player's Blizzard career groups for a single hero (or all heroes). */
export function careerMetrics(groups = [], role = '') {
  const g = Object.fromEntries(groups.map(x => [x.key, Object.fromEntries(x.stats.map(s => [s.key, s.value]))]));
  const out = {};
  const add = (key, group, value, label = pretty(key)) => { if (typeof value === 'number' && Number.isFinite(value)) out[key] = { key, group, value, label, pct: isPct(key), lower: isLower(key) }; };
  const game = g.game || {};
  out.__games = game.games_played ?? null;
  out.__time = game.time_played ?? 0;
  if (game.games_played) add('win_percentage', 'win', game.win_percentage ?? (game.games_won / game.games_played) * 100, 'Win rate');
  const avg = g.average || {};
  add('deaths_avg_per_10_min', 'survival', avg.deaths_avg_per_10_min, 'Deaths / 10 min');
  add('eliminations_per_life', 'survival', avg.eliminations_per_life, 'Eliminations per life');
  for (const k of ['eliminations', 'final_blows', 'solo_kills', 'hero_damage_done', 'healing_done', 'assists']) add(`${k}_avg_per_10_min`, 'impact', avg[`${k}_avg_per_10_min`]);
  for (const k of ['objective_time', 'obj_contest_time', 'objective_kills']) add(`${k}_avg_per_10_min`, 'objective', avg[`${k}_avg_per_10_min`]);
  const combat = g.combat || {};
  add('weapon_accuracy', 'accuracy', combat.weapon_accuracy, 'Weapon accuracy');
  add('critical_hit_accuracy', 'accuracy', combat.critical_hit_accuracy, 'Critical hit accuracy');
  for (const [k, v] of Object.entries(g.hero_specific || {})) {
    if (/most_in_game|best_in_game|most_in_life|best$/.test(k)) continue;           // records, not rates
    if (k.endsWith('_avg_per_10_min') || isPct(k)) add(k, 'ability', v);
  }
  return applyRole(out, role);
}

/** Combine one hero's metrics from several platforms, each rate weighted by time played there. */
export function mergeMetrics(list) {
  const parts = list.filter(x => x && x.__time > 0);
  if (parts.length <= 1) return parts[0] || list[0] || { __games: null };
  const out = { __games: parts.reduce((t, x) => t + (x.__games || 0), 0), __time: parts.reduce((t, x) => t + x.__time, 0) };
  for (const k of new Set(parts.flatMap(x => Object.keys(x).filter(k => !k.startsWith('__'))))) {
    const has = parts.filter(x => x[k]);
    const w = has.reduce((t, x) => t + x.__time, 0);
    out[k] = { ...has[0][k], value: has.reduce((t, x) => t + x[k].value * x.__time, 0) / w };
  }
  return out;
}

/** Rate metrics from the summary block (used for Role, and as a fallback). */
export function summaryMetrics(b, role = '') {
  if (!b) return { __games: null };
  const out = { __games: b.gamesPlayed ?? null };
  const add = (key, group, value, label) => { if (typeof value === 'number' && Number.isFinite(value)) out[key] = { key, group, value, label, pct: isPct(key) || key === 'win_percentage', lower: isLower(key) }; };
  if (b.gamesPlayed) add('win_percentage', 'win', b.winrate, 'Win rate');
  add('deaths_avg_per_10_min', 'survival', b.average?.deaths, 'Deaths / 10 min');
  add('kda', 'survival', b.kda, 'KDA');
  add('eliminations_avg_per_10_min', 'impact', b.average?.eliminations, 'Eliminations / 10 min');
  add('assists_avg_per_10_min', 'impact', b.average?.assists, 'Assists / 10 min');
  add('hero_damage_done_avg_per_10_min', 'impact', b.average?.damage, 'Damage / 10 min');
  add('healing_done_avg_per_10_min', 'impact', b.average?.healing, 'Healing / 10 min');
  return applyRole(out, role);
}

/** Who leads one stat: 'a', 'b', 'even' or '' (not comparable). */
export function lead(m, va, vb) {
  if (va == null || vb == null) return '';
  if (va === 0 && vb === 0) return 'even';
  const gap = Math.abs(va - vb);
  const band = m.pct ? RULES.pctBand : Math.max(RULES.relBand * Math.max(Math.abs(va), Math.abs(vb)), m.key.endsWith('_avg_per_10_min') ? RULES.minAbs : 0);
  if (gap <= band) return 'even';
  return (va > vb) !== m.lower ? 'a' : 'b';
}

/** Compare two metric sets. Returns rows grouped in display order plus the verdict. */
export function compareMetrics(ma, mb) {
  const ga = ma.__games ?? 0, gb = mb.__games ?? 0;
  const enough = ga >= RULES.minGames && gb >= RULES.minGames;
  const keys = [...new Set([...Object.keys(ma), ...Object.keys(mb)])].filter(k => !k.startsWith('__'));
  const rows = keys.map(k => {
    const m = ma[k] || mb[k]; const va = ma[k]?.value ?? null, vb = mb[k]?.value ?? null;
    const w = enough ? lead(m, va, vb) : '';
    const rel = va != null && vb != null && Math.max(Math.abs(va), Math.abs(vb)) ? Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb)) : 0;
    return { ...m, va, vb, w, rel, weight: GROUPS[m.group].weight };
  }).filter(r => !(r.va === 0 && r.vb === 0) && !(r.va == null && r.vb == null))
    .sort((x, y) => ORDER.indexOf(x.group) - ORDER.indexOf(y.group));
  const score = side => rows.filter(r => r.w === side).reduce((t, r) => t + r.weight, 0);
  const scoreA = score('a'), scoreB = score('b');
  const winner = !enough ? '' : Math.abs(scoreA - scoreB) <= RULES.closeScore ? 'close' : scoreA > scoreB ? 'a' : 'b';
  return { rows, enough, gamesA: ga, gamesB: gb, scoreA, scoreB, winner };
}

const fmtVal = (r, v) => (v == null ? '—' : r.pct ? `${(Math.round(v * 10) / 10).toFixed(1)}%` : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString());
export const formatValue = fmtVal;

// ---------- plain English ----------
const MEANING = {
  win_percentage: 'wins more of the games played',
  deaths_avg_per_10_min: 'stays alive more, so the team fights at full strength more often',
  eliminations_per_life: 'gets more out of each life',
  kda: 'trades better in fights',
  final_blows_avg_per_10_min: 'finishes more kills',
  solo_kills_avg_per_10_min: 'wins more fights alone',
  eliminations_avg_per_10_min: 'takes part in more kills',
  hero_damage_done_avg_per_10_min: 'puts more pressure on enemies',
  healing_done_avg_per_10_min: 'keeps the team healthier',
  assists_avg_per_10_min: 'sets up more team kills',
  objective_time_avg_per_10_min: 'holds the objective longer',
  obj_contest_time_avg_per_10_min: 'contests the objective more',
  objective_kills_avg_per_10_min: 'gets more kills on the objective',
  weapon_accuracy: 'lands more shots',
  critical_hit_accuracy: 'lands more critical hits',
  enemies_slept_avg_per_10_min: 'puts more enemies to sleep, which can cancel their ultimates',
  sleep_dart_accuracy: 'lands more sleep darts',
  nano_boost_assists_avg_per_10_min: 'turns more Nano Boosts into kills',
  biotic_grenade_kills_avg_per_10_min: 'gets more kills out of Biotic Grenades',
  players_saved_avg_per_10_min: 'saves more teammates from dying',
  players_resurrected_avg_per_10_min: 'brings back more teammates',
  damage_amplified_avg_per_10_min: 'adds more damage for the team',
  chain_hook_accuracy: 'lands more hooks',
  chain_hook_kills_avg_per_10_min: 'turns more hooks into kills',
  whole_hog_kills_avg_per_10_min: 'gets more out of Whole Hog',
  damage_blocked_avg_per_10_min: 'blocks more damage for the team',
  scoped_accuracy: 'lands more scoped shots',
  scoped_critical_hit_accuracy: 'lands more scoped headshots',
};
export function meaning(key) {
  if (MEANING[key]) return MEANING[key];
  if (/accuracy$/.test(key)) return 'lands it more often';
  if (/_kills_avg_per_10_min$/.test(key)) return 'gets more kills with it';
  if (/blocked/.test(key)) return 'protects the team more';
  return '';
}

const reason = (r, side, explain = false) => {
  const mine = side === 'a' ? r.va : r.vb, theirs = side === 'a' ? r.vb : r.va;
  const word = r.lower ? 'fewer' : r.pct ? 'higher' : 'more';
  const label = r.lower ? r.label.replace(/^Deaths/, 'deaths') : r.label.charAt(0).toLowerCase() + r.label.slice(1);
  const why = explain && meaning(r.key);
  return `${word} ${label} (${fmtVal(r, mine)} vs ${fmtVal(r, theirs)})${why ? ` — ${why}` : ''}`;
};
const list = xs => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const strongest = (rows, side, n) => rows.filter(r => r.w === side).sort((x, y) => y.weight - x.weight || y.rel - x.rel).slice(0, n);

/** Plain-English analysis as separate points, built only from the rows, same rules every time. */
export function summaryParts(res, nameA, nameB, subject, role = '') {
  if (!res.rows.length) return { headline: `Neither player has ${subject} stats to compare.`, points: [] };
  if (!res.enough) return { headline: `No call on ${subject}: ${nameA} has ${res.gamesA} game${res.gamesA === 1 ? '' : 's'} and ${nameB} has ${res.gamesB}.`, points: [`OverScope only compares players once both have ${RULES.minGames}+ games, because a few games swing every rate.`] };
  const evens = res.rows.filter(r => r.w === 'even');
  const winRow = res.rows.find(r => r.key === 'win_percentage');
  const points = [];
  let headline;
  if (res.winner === 'close') {
    headline = `Too close to call on ${subject} (weighted score ${res.scoreA}–${res.scoreB}).`;
    for (const [side, name] of [['a', nameA], ['b', nameB]]) {
      const s = strongest(res.rows, side, 2).map(r => reason(r, side, true));
      if (s.length) points.push(`${name}: ${list(s)}.`);
    }
  } else {
    const W = res.winner, L = W === 'a' ? 'b' : 'a';
    const wn = W === 'a' ? nameA : nameB, ln = W === 'a' ? nameB : nameA;
    headline = `${wn} performs better on ${subject} (weighted score ${Math.max(res.scoreA, res.scoreB)}–${Math.min(res.scoreA, res.scoreB)}).`;
    for (const r of strongest(res.rows, W, 3)) points.push(`${wn} has ${reason(r, W, true)}.`);
    const back = strongest(res.rows, L, 2).map(r => reason(r, L, true));
    if (back.length) points.push(`${ln} is stronger in ${list(back)}.`);
  }
  if (role) {
    const focus = res.rows.filter(r => r.group === 'focus');
    if (focus.length) {
      const fa = focus.filter(r => r.w === 'a').length, fb = focus.filter(r => r.w === 'b').length;
      points.push(`On what matters most for a ${role} (${list(focus.map(r => r.label.toLowerCase()))}): ${fa === fb ? 'even' : `${fa > fb ? nameA : nameB} leads`}.`);
    }
  }
  if (winRow?.w === 'even') points.push(`Win rates are within ${RULES.pctBand} points (${fmtVal(winRow, winRow.va)} vs ${fmtVal(winRow, winRow.vb)}), so results alone don't separate them.`);
  if (evens.length > (winRow?.w === 'even' ? 1 : 0)) points.push(`${evens.length} stat${evens.length === 1 ? ' was' : 's were'} too close to separate.`);
  const few = Math.min(res.gamesA, res.gamesB);
  if (few < 20) points.push(`Small sample: the player with fewer games has ${few}.`);
  return { headline, points };
}
export function writeSummary(res, nameA, nameB, subject, role = '') {
  const p = summaryParts(res, nameA, nameB, subject, role);
  return [p.headline, ...p.points].join(' ');
}

// ---------- best-game records (shown, never counted) ----------
const recordLabel = k => {
  if (k === 'kill_streak_best') return 'Best kill streak';
  if (k === 'multikill_best') return 'Best multikill';
  const m = /^(.*)_(most|best)_in_(game|life)$/.exec(k);
  if (!m) return pretty(k);
  const what = m[1].replace(/^all_damage_done$/, 'damage (incl. barriers)').replace(/_/g, ' ').replace(/\bobj\b/, 'objective').replace(/ done$/, '');
  return `${m[2] === 'best' ? 'Best' : 'Most'} ${what} in ${m[3] === 'game' ? 'a game' : 'one life'}`;
};
/** Personal bests from career groups: the general "best" group plus hero-specific records. */
export function records(groups = []) {
  const out = {};
  for (const grp of groups) {
    if (grp.key !== 'best' && grp.key !== 'hero_specific') continue;
    for (const s of grp.stats) {
      if (grp.key === 'hero_specific' && !/_(most|best)_in_(game|life)$/.test(s.key)) continue;
      if (/time_spent_on_fire|melee/.test(s.key)) continue;
      out[s.key] = { key: s.key, label: recordLabel(s.key), value: s.value, time: /time/.test(s.key), pct: /accuracy/.test(s.key) };
    }
  }
  return out;
}

// ---------- play-style fingerprint ----------
const AXES = [
  ['Aggression', ['final_blows_avg_per_10_min', 'eliminations_avg_per_10_min']],
  ['Damage', ['hero_damage_done_avg_per_10_min']],
  ['Healing', ['healing_done_avg_per_10_min']],
  ['Teamwork', ['assists_avg_per_10_min']],
  ['Survival', ['eliminations_per_life', 'deaths_avg_per_10_min']],
  ['Objective', ['objective_time_avg_per_10_min']],
  ['Accuracy', ['weapon_accuracy']],
];
/** Style axes scaled 0–1 against the stronger of the two players on each axis. */
export function fingerprint(ma, mb) {
  const raw = m => key => { const v = m[key]?.value; if (v == null) return null; return key === 'deaths_avg_per_10_min' ? (v > 0 ? 10 / v : null) : v; };
  const out = [];
  for (const [label, keys] of AXES) {
    const key = keys.find(k => ma[k] != null || mb[k] != null);
    if (!key) continue;
    const a = raw(ma)(key), b = raw(mb)(key);
    const top = Math.max(a || 0, b || 0);
    if (!top) continue;
    out.push({ label, key, a: (a || 0) / top, b: (b || 0) / top });
  }
  return out;
}

// ---------- shared-hero scoreboard ----------
/**
 * heroesA/heroesB: summary hero rows ({hero, gamesPlayed, winrate}); careerA/careerB: hero -> groups.
 * Returns one comparison per hero both players have 5+ games on, most-played first.
 */
export function scoreboard(heroesA, heroesB, careerA, careerB, roleOf) {
  const byB = new Map(heroesB.map(h => [h.hero, h]));
  const rows = [];
  for (const ha of heroesA) {
    const hb = byB.get(ha.hero);
    if (!hb || ha.gamesPlayed < RULES.minGames || hb.gamesPlayed < RULES.minGames) continue;
    const role = roleOf(ha.hero);
    const build = (groups, h) => {
      const m = groups?.length ? careerMetrics(groups, role) : summaryMetrics(h, role);
      m.__games = h.gamesPlayed;
      if (m.win_percentage && h.winrate != null) m.win_percentage = { ...m.win_percentage, value: h.winrate };
      return m;
    };
    const res = compareMetrics(build(careerA[ha.hero], ha), build(careerB[ha.hero], hb));
    rows.push({ hero: ha.hero, gamesA: ha.gamesPlayed, gamesB: hb.gamesPlayed, ...res });
  }
  rows.sort((x, y) => (y.gamesA + y.gamesB) - (x.gamesA + x.gamesB));
  const count = w => rows.filter(r => r.winner === w).length;
  return { rows, winsA: count('a'), winsB: count('b'), close: count('close') };
}
/** A player's best hero: highest win rate among heroes with 10+ games (ties: more games). */
export function bestHero(heroes, minGames = 10) {
  return [...heroes].filter(h => h.gamesPlayed >= minGames && h.winrate != null).sort((a, b) => b.winrate - a.winrate || b.gamesPlayed - a.gamesPlayed)[0] || null;
}

// ---------- duo fit ----------
/**
 * rolesA/rolesB: { tank|damage|support: {gamesPlayed, gamesWon} }.
 * Role Queue has one tank, two damage and two supports, so two players can share damage or
 * support but not tank. Picks the pairing with the highest combined win rate (10+ games each).
 */
export function duoFit(rolesA, rolesB) {
  const wr = r => (r?.gamesPlayed >= RULES.duoMinGames ? (r.gamesWon / r.gamesPlayed) * 100 : null);
  const roles = ['tank', 'damage', 'support'];
  const options = [];
  for (const ra of roles) for (const rb of roles) {
    if (ra === 'tank' && rb === 'tank') continue;
    const a = wr(rolesA?.[ra]), b = wr(rolesB?.[rb]);
    if (a == null || b == null) continue;
    options.push({ roleA: ra, roleB: rb, winA: a, winB: b, gamesA: rolesA[ra].gamesPlayed, gamesB: rolesB[rb].gamesPlayed, score: a + b });
  }
  options.sort((x, y) => y.score - x.score || (y.gamesA + y.gamesB) - (x.gamesA + x.gamesB));
  return options;
}
