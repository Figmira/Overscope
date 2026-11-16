// Head-to-head rules for Player vs Player. Pure functions, no page code, so the same
// rules apply everywhere and the unit tests can check them.
//
// Rules (agreed with the site owner):
//  - Only rates are compared (per 10 minutes, percentages, per life). Totals and
//    "best in a game" records are left out because they reward time played.
//  - Both players need 5+ games in what is compared, or no stat is called.
//  - "Even" band: percentages need a 2-point gap; everything else a 5% gap
//    (and at least 0.1 for small per-10 counts).
//  - Weights: win rate x2, hero ability stats x2, survival x2, everything else x1.
//  - If the weighted scores are within 1 point, the verdict is "too close to call".

export const RULES = { minGames: 5, relBand: 0.05, pctBand: 2, minAbs: 0.1, closeScore: 1 };
export const GROUPS = {
  win: { label: 'Winning', weight: 2 },
  ability: { label: 'Hero abilities', weight: 2 },
  survival: { label: 'Survival', weight: 2 },
  impact: { label: 'Impact', weight: 1 },
  accuracy: { label: 'Accuracy', weight: 1 },
  objective: { label: 'Objective', weight: 1 },
};
const ORDER = Object.keys(GROUPS);

const pretty = k => {
  const s = k.replace(/_avg_per_10_min$/, '').replace(/_/g, ' ').replace(/\bobj\b/, 'objective').replace(/\bhero damage done\b/, 'hero damage').replace(/\bhealing done\b/, 'healing');
  return s[0].toUpperCase() + s.slice(1) + (k.endsWith('_avg_per_10_min') ? ' / 10 min' : '');
};
const isPct = k => /accuracy|percentage/.test(k);
const isLower = k => /deaths|damage_taken/.test(k);

/** Rate metrics from one player's Blizzard career groups for a single hero. */
export function careerMetrics(groups = []) {
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
  return out;
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

/** Rate metrics from the summary block (used for Overall and Role). */
export function summaryMetrics(b) {
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
  return out;
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

const reason = (r, side) => {
  const mine = side === 'a' ? r.va : r.vb, theirs = side === 'a' ? r.vb : r.va;
  const word = r.lower ? 'fewer' : r.pct ? 'higher' : 'more';
  const label = r.lower ? r.label.replace(/^Deaths/, 'deaths') : r.label.charAt(0).toLowerCase() + r.label.slice(1);
  return `${word} ${label} (${fmtVal(r, mine)} vs ${fmtVal(r, theirs)})`;
};
const list = xs => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const strongest = (rows, side, n) => rows.filter(r => r.w === side).sort((x, y) => y.weight - x.weight || y.rel - x.rel).slice(0, n);

/** Plain-English summary built only from the rows above, using the same rules every time. */
export function writeSummary(res, nameA, nameB, subject) {
  if (!res.rows.length) return `Neither player has ${subject} stats to compare.`;
  if (!res.enough) return `No call on ${subject}: ${nameA} has ${res.gamesA} game${res.gamesA === 1 ? '' : 's'} and ${nameB} has ${res.gamesB}. OverScope only compares players once both have ${RULES.minGames}+ games, because a few games swing every rate.`;
  const evens = res.rows.filter(r => r.w === 'even');
  const winRow = res.rows.find(r => r.key === 'win_percentage');
  const out = [];
  if (res.winner === 'close') {
    const a = strongest(res.rows, 'a', 2).map(r => reason(r, 'a')), b = strongest(res.rows, 'b', 2).map(r => reason(r, 'b'));
    out.push(`Too close to call on ${subject} (weighted score ${res.scoreA}–${res.scoreB}).`);
    if (a.length) out.push(`${nameA} has ${list(a)}.`);
    if (b.length) out.push(`${nameB} has ${list(b)}.`);
  } else {
    const W = res.winner, L = W === 'a' ? 'b' : 'a';
    const wn = W === 'a' ? nameA : nameB, ln = W === 'a' ? nameB : nameA;
    out.push(`${wn} performs better on ${subject} (weighted score ${Math.max(res.scoreA, res.scoreB)}–${Math.min(res.scoreA, res.scoreB)}), mainly because of ${list(strongest(res.rows, W, 3).map(r => reason(r, W)))}.`);
    const back = strongest(res.rows, L, 2).map(r => reason(r, L));
    if (back.length) out.push(`${ln} is stronger in ${list(back)}.`);
  }
  if (winRow?.w === 'even') out.push(`Win rates are within ${RULES.pctBand} points (${fmtVal(winRow, winRow.va)} vs ${fmtVal(winRow, winRow.vb)}), so results alone don't separate them.`);
  if (evens.length > (winRow?.w === 'even' ? 1 : 0)) out.push(`${evens.length} stat${evens.length === 1 ? ' was' : 's were'} too close to separate.`);
  const few = Math.min(res.gamesA, res.gamesB);
  if (few < 20) out.push(`Small sample: the player with fewer games has ${few}.`);
  return out.join(' ');
}
