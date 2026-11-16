// OverScope data layer — runs entirely in the visitor's browser.
// Live data comes straight from the OverFast API (which reads Blizzard's public
// pages and allows browser requests). Public Blizzard news and the daily public
// hero-stat snapshots are files in /data, refreshed by a GitHub Action.
// Nothing about a visitor is sent anywhere except the request itself; personal
// things (favorites, match log, viewed-profile history) stay in this browser.

export const OVERFAST = 'https://overfast-api.tekrop.fr';
const ROLES = new Set(['tank', 'damage', 'support']);
export const PLATFORMS = ['pc', 'console'];
export const REGIONS = ['americas', 'europe', 'asia'];
// divisions accepted by the official hero-rate filter (verified upstream)
export const STAT_DIVISIONS = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster'];
const PLAYER_DIVS = [...STAT_DIVISIONS, 'champion'];
export const QUEUES = { competitive: { gamemode: 'competitive', label: 'Competitive · 5v5 Role Queue' }, quickplay: { gamemode: 'quickplay', label: 'Quick Play · Role Queue' } };

export class ApiError extends Error { constructor(msg, status = 0) { super(msg); this.status = status; } }
const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const ID_RE = /^[\p{L}\p{N}_|-]{2,80}$/u;

// ---------------- fetching: cache + concurrency + 429 handling ----------------
const mem = new Map();
const inflight = new Map();
const SS = 'os.c.';
function cacheGet(key, ttl) {
  const m = mem.get(key);
  if (m && Date.now() - m.at < ttl) return m;
  try { const s = JSON.parse(sessionStorage.getItem(SS + key) || 'null'); if (s && Date.now() - s.at < ttl) { mem.set(key, s); return s; } } catch { /* storage off */ }
  return null;
}
function cacheSet(key, data) {
  const e = { at: Date.now(), data };
  mem.set(key, e);
  try { sessionStorage.setItem(SS + key, JSON.stringify(e)); } catch { /* full or disabled: memory cache still works */ }
  return e;
}
let active = 0; const waiting = [];
const acquire = () => new Promise(r => { if (active < 4) { active++; r(); } else waiting.push(r); });
const release = () => { active--; const n = waiting.shift(); if (n) { active++; n(); } };
let slowUntil = 0;

async function getJSON(url, ttl, { fresh = false } = {}) {
  const hit = !fresh && cacheGet(url, ttl);
  if (hit) return { data: hit.data, fetchedAt: hit.at };
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    if (Date.now() < slowUntil) throw new ApiError(`The stats service asked us to slow down. Try again in ${Math.ceil((slowUntil - Date.now()) / 1000)} s.`, 429);
    await acquire();
    try {
      let res;
      try { res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } }); }
      catch (e) { throw new ApiError(e.name === 'TimeoutError' ? 'The data service took too long to answer.' : 'Could not reach the data service. Check your connection.', 0); }
      if (res.status === 429) { const s = Number(res.headers.get('retry-after')) || 30; slowUntil = Date.now() + s * 1000; throw new ApiError(`Too many requests to the stats service. Try again in ${s} s.`, 429); }
      let body = null; try { body = await res.json(); } catch { /* not JSON */ }
      if (!res.ok) {
        const d = body?.error || body?.detail; const m = typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => x.msg).join('; ') : '';
        throw new ApiError(m || `Request failed (HTTP ${res.status})`, res.status);
      }
      const e = cacheSet(url, body);
      return { data: body, fetchedAt: e.at };
    } finally { release(); }
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
const of = (path, params = {}) => {
  const u = new URL(path, OVERFAST);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u.toString();
};
// files published with the site (news, public stat history, media manifest)
const site = p => new URL(p, document.baseURI).toString();

// ---------------- normalisers (validate every response) ----------------
export function normaliseHeroList(raw) {
  if (!Array.isArray(raw)) throw new ApiError('Hero list was not in the expected format');
  const out = raw.map(h => ({ key: str(h.key), name: str(h.name), role: str(h.role), subrole: str(h.subrole), portrait: str(h.portrait), gamemodes: Array.isArray(h.gamemodes) ? h.gamemodes.map(str) : [] }))
    .filter(h => h.key && h.name && ROLES.has(h.role));
  if (out.length < 10) throw new ApiError(`Hero list looked wrong (${out.length} heroes)`);
  return out;
}
export function extractStadium(raw) {
  const s = raw.stadium || raw.stadium_data || {};
  const pick = (...c) => c.find(x => Array.isArray(x) && x.length) || [];
  const norm = x => ({ name: str(x.name || x.title), description: str(x.description || x.effect || x.text), icon: str(x.icon || x.image), cost: num(x.cost ?? x.price), rarity: str(x.rarity), category: str(x.category || x.type) });
  return { powers: pick(s.powers, raw.stadium_powers, raw.stadiumPowers).map(norm).filter(x => x.name), items: pick(s.items, raw.stadium_items, raw.stadiumItems).map(norm).filter(x => x.name) };
}
export function normaliseHeroDetail(key, raw) {
  if (!raw || typeof raw !== 'object' || !raw.name) throw new ApiError('Hero details were not in the expected format');
  const hp = raw.hitpoints || {};
  return {
    key, name: str(raw.name), role: str(raw.role), description: str(raw.description), portrait: str(raw.portrait), location: str(raw.location),
    age: num(raw.age), birthday: str(raw.birthday), hitpoints: { health: num(hp.health), armor: num(hp.armor), shields: num(hp.shields), total: num(hp.total) },
    abilities: Array.isArray(raw.abilities) ? raw.abilities.map(a => ({ name: str(a.name), description: str(a.description), icon: str(a.icon) })).filter(a => a.name) : [],
    stadium: extractStadium(raw),
  };
}
export function normaliseStats(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.heroes) ? raw.heroes : null;
  if (!list) throw new ApiError('Hero statistics were not in the expected format');
  return list.map(x => ({ hero: str(x.hero || x.key), pickrate: num(x.pickrate ?? x.pick_rate), winrate: num(x.winrate ?? x.win_rate), banrate: num(x.banrate ?? x.ban_rate) }))
    .filter(x => x.hero && x.pickrate !== null && x.winrate !== null);
}
const normaliseRank = r => (r && typeof r === 'object' ? { division: str(r.division), tier: num(r.tier), rankIcon: str(r.rank_icon), roleIcon: str(r.role_icon), tierIcon: str(r.tier_icon) } : null);
const normaliseBlock = b => (b && typeof b === 'object' ? { gamesPlayed: num(b.games_played), gamesWon: num(b.games_won), gamesLost: num(b.games_lost), timePlayed: num(b.time_played), winrate: num(b.winrate), kda: num(b.kda), total: b.total || null, average: b.average || null } : null);
export function rankValue(r) {
  if (!r?.division) return null;
  const d = PLAYER_DIVS.indexOf(r.division.toLowerCase());
  return d < 0 || !r.tier ? null : d * 5 + (6 - r.tier);
}

// ---------------- data functions ----------------
export async function heroes() {
  const r = await getJSON(of('/heroes'), 6 * 3600_000);
  return { data: normaliseHeroList(r.data), fetchedAt: r.fetchedAt, source: of('/heroes') };
}
export async function stadiumHeroes() {
  try {
    const r = await heroes();
    const list = r.data.filter(h => h.gamemodes.includes('stadium'));
    return list.length ? { ...r, data: list } : { data: null, unavailable: 'Hero list has no Stadium flags' };
  } catch (e) { return { data: null, unavailable: e.message }; }
}
export async function heroDetail(key) {
  if (!/^[a-z0-9-]{2,40}$/.test(key)) throw new ApiError('Unknown hero', 400);
  const r = await getJSON(of(`/heroes/${key}`), 6 * 3600_000);
  return { data: normaliseHeroDetail(key, r.data), fetchedAt: r.fetchedAt };
}

/** One queue's official hero table. Open Queue is never answered with Role Queue data. */
export async function statsFor({ queue, platform = 'pc', region = 'americas', division = '', role = '', map = '' }, opts) {
  if (queue === 'open') return { available: false, queue, reason: "No verified public source publishes aggregate Competitive Open Queue hero statistics. Blizzard's official hero-rate tables (relayed by OverFast) cover Role Queue Competitive and Quick Play only." };
  const q = QUEUES[queue];
  if (!q) throw new ApiError('Unknown queue', 400);
  if (!PLATFORMS.includes(platform) || !REGIONS.includes(region)) throw new ApiError('Unknown platform or region', 400);
  if (division && (!STAT_DIVISIONS.includes(division) || queue !== 'competitive')) throw new ApiError('Rank filter only applies to Competitive', 400);
  if (role && !ROLES.has(role)) throw new ApiError('Unknown role', 400);
  if (map && !/^[a-z0-9-_]{2,40}$/.test(map)) throw new ApiError('Unknown map', 400);
  const url = of('/heroes/stats', { platform, gamemode: q.gamemode, region, competitive_division: division || undefined, role: role || undefined, map: map || undefined });
  const r = await getJSON(url, 30 * 60_000, opts);
  const rows = normaliseStats(r.data);
  return {
    available: true, queue, label: q.label, rows, hasBanRate: rows.some(x => x.banrate !== null),
    filters: { platform, region, division: division || 'all', role: role || 'all', map: map || 'all' },
    source: { provider: 'Blizzard official hero statistics, relayed by OverFast API', endpoint: url, fetchedAt: r.fetchedAt, stale: false },
  };
}
export async function statsByRank({ platform = 'pc', region = 'americas', live = false } = {}) {
  // Fast path: the GitHub Action saves these 8 public tables once a day.
  if (!live && PLATFORMS.includes(platform) && REGIONS.includes(region)) {
    try {
      const f = (await getJSON(site(`data/ranks/competitive-${platform}-${region}.json`), 30 * 60_000)).data;
      if (f?.divisions && Date.now() - Date.parse(f.fetchedAt) < 36 * 3600_000 && STAT_DIVISIONS.every(d => Array.isArray(f.divisions[d]) && f.divisions[d].length)) {
        const divisions = {};
        for (const d of STAT_DIVISIONS) divisions[d] = normaliseStats(f.divisions[d]);
        return { platform, region, divisions, errors: {}, fetchedAt: Date.parse(f.fetchedAt), saved: true };
      }
    } catch { /* fall through to live */ }
  }
  const out = { platform, region, divisions: {}, errors: {}, fetchedAt: Date.now(), saved: false };
  await Promise.all(STAT_DIVISIONS.map(async division => {
    try { const r = await statsFor({ queue: 'competitive', platform, region, division }); out.divisions[division] = r.rows; out.fetchedAt = Math.min(out.fetchedAt, r.source.fetchedAt); }
    catch (e) { out.errors[division] = e.message; }
  }));
  return out;
}

/** Daily public snapshots saved by the GitHub Action: all ranks, or one rank (competitive). */
export async function trend({ queue, platform = 'pc', region = 'americas', division = 'all', role = 'all', map = 'all', days = 14 }) {
  if (!QUEUES[queue]) return { available: false, days: [], snapshots: [] };
  if (role !== 'all' || map !== 'all') return { available: true, days: [], snapshots: [], note: 'History is recorded for all roles and maps only.' };
  const perRank = division !== 'all' && division !== '';
  if (perRank && (queue !== 'competitive' || !STAT_DIVISIONS.includes(division))) return { available: true, days: [], snapshots: [] };
  if (!PLATFORMS.includes(platform) || !REGIONS.includes(region)) throw new ApiError('Unknown platform or region', 400);
  const path = perRank ? `data/history-ranks/${queue}-${platform}-${region}-${division}.json` : `data/history/${queue}-${platform}-${region}.json`;
  let file = null;
  try { file = (await getJSON(site(path), 30 * 60_000)).data; }
  catch (e) { if (e.status !== 404) throw e; }
  let snaps = (file?.snapshots || []).slice(-Math.min(400, days));
  if (perRank) snaps = snaps.map(x => ({ day: x.day, rows: x.rows.map(([hero, pickrate, winrate, banrate]) => ({ hero, pickrate, winrate, banrate })) }));
  return { available: true, queue, division: perRank ? division : 'all', days: snaps.map(x => x.day), snapshots: snaps };
}
/** How many saved days each history file holds (written by the GitHub Action). */
export async function historyIndex() {
  try { return (await getJSON(site('data/history-index.json'), 30 * 60_000)).data; } catch { return { allRanks: {}, ranks: {} }; }
}

export async function maps() {
  const [m, g, modes] = await Promise.allSettled([getJSON(of('/maps'), 6 * 3600_000), getJSON(of('/gamemodes'), 6 * 3600_000), getJSON(site('data/modes.json'), 24 * 3600_000)]);
  if (m.status === 'rejected') throw m.reason;
  if (!Array.isArray(m.value.data)) throw new ApiError('Map list was not in the expected format');
  return {
    data: m.value.data.map(x => ({ key: str(x.key), name: str(x.name), screenshot: str(x.screenshot), gamemodes: Array.isArray(x.gamemodes) ? x.gamemodes.map(str) : [], location: str(x.location), country: str(x.country_code) })).filter(x => x.key && x.name),
    fetchedAt: m.value.fetchedAt, stale: false, source: of('/maps'),
    gamemodes: g.status === 'fulfilled' && Array.isArray(g.value.data) ? g.value.data.map(x => ({ key: str(x.key), name: str(x.name), description: str(x.description) })) : [],
    mechanics: modes.status === 'fulfilled' ? modes.value.data : {},
  };
}

export async function searchPlayers(name) {
  name = str(name).trim();
  if (name.length < 2 || name.length > 40) throw new ApiError('Enter 2–40 characters', 400);
  const r = await getJSON(of('/players', { name, limit: 20 }), 5 * 60_000);
  const list = Array.isArray(r.data?.results) ? r.data.results : [];
  return { total: num(r.data?.total) ?? list.length, results: list.map(p => ({ id: safeDecode(str(p.player_id)), name: str(p.name), avatar: str(p.avatar), title: str(p.title?.en_US ?? p.title ?? ''), isPublic: p.is_public !== false })).filter(p => p.id) };
}

function tagVariants(id) {
  const m = /^(.+)-(\d{3,6})$/.exec(id);
  if (!m) return [id];
  const n = m[1];
  return [...new Set([n, n[0].toUpperCase() + n.slice(1), n.toLowerCase()])].map(v => `${v}-${m[2]}`);
}
export async function playerProfile(rawId) {
  let id = safeDecode(str(rawId)).replace('#', '-').trim();
  if (!ID_RE.test(id)) throw new ApiError('Invalid BattleTag (use Name-1234)', 400);
  let sum, lastErr;
  for (const c of tagVariants(id)) {
    try { sum = await getJSON(of(`/players/${encodeURIComponent(c)}/summary`), 5 * 60_000); id = c; break; }
    catch (e) { lastErr = e; if (e.status !== 404) throw e; }
  }
  if (!sum) throw lastErr;
  const s = sum.data || {};
  const p = { id, username: str(s.username), avatar: str(s.avatar), namecard: str(s.namecard), title: str(s.title?.en_US ?? s.title), endorsement: num(s.endorsement?.level), competitive: {}, lastUpdated: s.last_updated_at ?? null, stats: {}, privacy: 'public' };
  for (const plat of PLATFORMS) {
    const c = s.competitive?.[plat];
    if (c) p.competitive[plat] = { season: num(c.season), tank: normaliseRank(c.tank), damage: normaliseRank(c.damage), support: normaliseRank(c.support), open: normaliseRank(c.open) };
  }
  await Promise.all(['competitive', 'quickplay'].map(async gamemode => {
    try {
      const d = (await getJSON(of(`/players/${encodeURIComponent(id)}/stats/summary`, { gamemode }), 5 * 60_000)).data || {};
      const heroesList = Object.entries(d.heroes || {}).map(([k, v]) => ({ hero: k, ...normaliseBlock(v) })).filter(h => h.timePlayed).sort((a, b) => b.timePlayed - a.timePlayed);
      p.stats[gamemode] = { general: normaliseBlock(d.general), roles: Object.fromEntries(Object.entries(d.roles || {}).map(([k, v]) => [k, normaliseBlock(v)])), heroes: heroesList };
    } catch (e) { p.stats[gamemode] = { error: e.message, status: e.status }; }
  }));
  if (!Object.values(p.stats).some(x => x.general?.gamesPlayed) && !Object.keys(p.competitive).length) p.privacy = 'private-or-empty';
  saveLocalSnapshot(p);
  return { data: p, fetchedAt: sum.fetchedAt };
}

/** A player's Competitive hero stats on one platform (current season, public profiles only). */
export async function playerCompHeroes(rawId, { platform = 'pc' } = {}) {
  const id = safeDecode(str(rawId));
  if (!ID_RE.test(id) || !PLATFORMS.includes(platform)) throw new ApiError('Invalid request', 400);
  const d = (await getJSON(of(`/players/${encodeURIComponent(id)}/stats/summary`, { gamemode: 'competitive', platform }), 5 * 60_000)).data || {};
  return Object.entries(d.heroes || {}).map(([k, v]) => ({ hero: k, ...normaliseBlock(v) })).filter(h => h.gamesPlayed);
}
const CAREER_GROUPS = { average: 'Per 10 minutes', best: 'Best in a game / life', combat: 'Combat totals', assists: 'Assists', game: 'Games', hero_specific: 'Hero-specific', match_awards: 'Match awards', miscellaneous: 'Miscellaneous' };
export async function playerCareer(rawId, { gamemode = 'competitive', hero = '' } = {}) {
  const id = safeDecode(str(rawId));
  if (!ID_RE.test(id) || !['competitive', 'quickplay'].includes(gamemode) || (hero && !/^[a-z0-9-]{2,40}$/.test(hero))) throw new ApiError('Invalid request', 400);
  const r = await getJSON(of(`/players/${encodeURIComponent(id)}/stats/career`, { gamemode, hero: hero || undefined }), 5 * 60_000);
  const out = {};
  for (const [h, groups] of Object.entries(r.data || {})) {
    if (!groups || typeof groups !== 'object') continue;
    out[h] = Object.entries(groups).filter(([, v]) => v && typeof v === 'object').map(([g, v]) => ({
      key: g, label: CAREER_GROUPS[g] || g.replace(/_/g, ' '),
      stats: Object.entries(v).filter(([, n]) => typeof n === 'number').map(([k, n]) => ({ key: k, label: k.replace(/_/g, ' ').replace(/\bavg per 10 min\b/, '/ 10 min'), value: n })),
    })).filter(g => g.stats.length);
  }
  return { data: out, fetchedAt: r.fetchedAt };
}

// ---------------- viewed-profile history: this browser only ----------------
const HIST = 'overscope.history.v1';
const readHist = () => { try { const x = JSON.parse(localStorage.getItem(HIST) || '{}'); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
function saveLocalSnapshot(p) {
  if (p.privacy !== 'public') return;
  const day = new Date().toISOString().slice(0, 10);
  const comp = {};
  for (const [plat, c] of Object.entries(p.competitive)) {
    comp[plat] = { season: c.season };
    for (const role of ['tank', 'damage', 'support', 'open']) comp[plat][role] = c[role] ? { division: c[role].division, tier: c[role].tier, value: rankValue(c[role]) } : null;
  }
  const stats = {};
  for (const m of ['competitive', 'quickplay']) { const g = p.stats[m]?.general; if (g) stats[m] = { gamesPlayed: g.gamesPlayed, winrate: g.winrate, kda: g.kda, timePlayed: g.timePlayed }; }
  const all = readHist();
  const list = (all[p.id] || []).filter(s => s.day !== day);
  list.push({ day, id: p.id, comp, stats });
  all[p.id] = list.slice(-400);
  try { localStorage.setItem(HIST, JSON.stringify(all)); } catch { /* storage full/disabled */ }
}
export function playerHistory(id) {
  const snaps = (readHist()[safeDecode(id)] || []).sort((a, b) => a.day.localeCompare(b.day));
  return { id, days: snaps.length, snapshots: snaps };
}
export function clearPlayerHistory(id) { const all = readHist(); delete all[id]; try { localStorage.setItem(HIST, JSON.stringify(all)); } catch { /* ignore */ } }

// ---------------- public files published by the GitHub Action ----------------
export async function news(opts) {
  try { return (await getJSON(site('data/news.json'), 10 * 60_000, opts)).data; }
  catch (e) { throw new ApiError(e.status === 404 ? 'The news file has not been generated yet. It is created by the site\'s GitHub Action.' : e.message, e.status); }
}
export async function media() {
  try { return (await getJSON(site('data/media.json'), 60 * 60_000)).data; } catch { return null; }
}

/** Router so pages can keep calling api('/api/…') as before. */
export async function route(path, { fresh = false } = {}) {
  const u = new URL(path, 'https://x.invalid');
  const p = Object.fromEntries(u.searchParams);
  const seg = u.pathname.replace(/^\/api\//, '').split('/').map(safeDecode);
  switch (seg[0]) {
    case 'heroes': return seg[1] ? heroDetail(seg[1]) : p.gamemode === 'stadium' ? stadiumHeroes() : heroes();
    case 'stats': return seg[1] === 'by-rank' ? statsByRank({ ...p, live: fresh || p.live === '1' }) : statsFor(p, { fresh });
    case 'trend': return seg[1] === 'index' ? historyIndex() : trend({ ...p, days: Number(p.days) || 14 });
    case 'maps': return maps();
    case 'news': return news({ fresh });
    case 'players':
      if (!seg[1]) return searchPlayers(p.name);
      if (seg[2] === 'history') return playerHistory(seg[1]);
      if (seg[2] === 'career') return playerCareer(seg[1], p);
      if (seg[2] === 'comp-heroes') return playerCompHeroes(seg[1], p);
      return playerProfile(seg[1]);
    default: throw new ApiError('Unknown data request', 404);
  }
}
