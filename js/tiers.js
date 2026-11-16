// Tier list maths. Pure functions, no browser APIs, so the GitHub Action can
// use the exact same rules to build the Google-visible pages.
//
// Inputs are ONLY Blizzard's published pick and win rates. Blizzard does not
// publish game counts, so the score trusts a win rate more when the hero is
// picked often (a 54% win rate on a rarely-picked hero is weaker evidence).
//
//   m           = median pick rate of the hero's role (tanks, damage and
//                 supports are picked at different rates, so each role is
//                 compared with itself)
//   reliability = pick / (pick + m)            → 0.5 for a typical hero
//   win edge    = (win − 50) × reliability     → percentage points
//   popularity  = 0.75 × ln(pick / m)          → + if picked more than typical
//   score       = win edge + popularity
//
// Heroes are then ranked by score and cut into tiers by share of the roster.

export const TIERS = [
  { tier: 'S', share: 0.08, label: 'Strongest picks right now' },
  { tier: 'A', share: 0.20, label: 'Strong' },
  { tier: 'B', share: 0.37, label: 'Solid' },
  { tier: 'C', share: 0.22, label: 'Below average' },
  { tier: 'D', share: 0.13, label: 'Struggling' },
];

export const METHOD = 'Tiers are calculated only from Blizzard\'s published pick and win rates. Win rate counts more when a hero is picked often (Blizzard does not publish game counts, so popular heroes give stronger evidence), and heroes picked more than is typical for their role get a small boost. Each role is compared with itself, then all heroes are ranked and split: top 8% S, next 20% A, 37% B, 22% C, bottom 13% D.';

const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * @param rows  [{hero, pickrate, winrate, banrate?}]  official table rows
 * @param roleOf  hero key → 'tank' | 'damage' | 'support'
 * @returns rows sorted best→worst with {role, score, tier, winEdge, popularity}
 */
export function computeTiers(rows, roleOf) {
  const usable = rows.filter(r => Number.isFinite(r.pickrate) && Number.isFinite(r.winrate) && r.pickrate > 0 && roleOf(r.hero));
  const byRole = {};
  for (const r of usable) (byRole[roleOf(r.hero)] ||= []).push(r.pickrate);
  const med = Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, median(v) || 1]));
  const scored = usable.map(r => {
    const role = roleOf(r.hero), m = med[role];
    const reliability = r.pickrate / (r.pickrate + m);
    const winEdge = (r.winrate - 50) * reliability;
    const popularity = 0.75 * Math.log(r.pickrate / m);
    return { ...r, role, winEdge: round(winEdge), popularity: round(popularity), score: round(winEdge + popularity) };
  }).sort((a, b) => b.score - a.score || b.winrate - a.winrate);
  const n = scored.length;
  let start = 0, acc = 0;
  for (const t of TIERS) {
    acc += t.share;
    const end = t === TIERS[TIERS.length - 1] ? n : Math.round(acc * n);
    for (let i = start; i < end; i++) scored[i].tier = t.tier;
    start = end;
  }
  return scored;
}
const round = v => Math.round(v * 100) / 100;

/** Group scored rows by tier letter (keeps S→D order, empty tiers included). */
export function groupTiers(scored) {
  return TIERS.map(t => ({ ...t, heroes: scored.filter(r => r.tier === t.tier) }));
}
