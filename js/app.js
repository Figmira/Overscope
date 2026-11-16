// OverScope client: hash router + shared loaders.
import { $, $$, api, loadManifest, setRoster, toast, getManifest, esc, heroCutout } from './lib.js';

const pages = {
  home: () => import('./pages/home.js'),
  heroes: () => import('./pages/heroes.js'),
  competitive: () => import('./pages/competitive.js'),
  'tier-list': () => import('./pages/tierlist.js'),
  stadium: () => import('./pages/stadium.js'),
  maps: () => import('./pages/maps.js'),
  players: () => import('./pages/players.js'),
  news: () => import('./pages/news.js'),
  sources: () => import('./pages/sources.js'),
};

export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'home', param: parts[1] || '', query: new URLSearchParams(q) };
}
// Google-visible pages (built by scripts/build-site.mjs) are plain HTML; any
// in-app link from them opens the main app instead of re-rendering in place.
const STATIC = document.body.dataset.static === '1';
export function go(hash) {
  if (STATIC) { location.href = new URL(hash, document.baseURI).href; return; }
  if (location.hash === hash) render(); else location.hash = hash;
}

let controller = null;
async function render() {
  const route = parseRoute();
  const loader = pages[route.page] || pages.home;
  controller?.abort();
  controller = new AbortController();
  const main = $('#main');
  $('#banner-slot').innerHTML = '';
  document.body.dataset.page = route.page;
  document.documentElement.dataset.page = route.page;
  // nav highlighting
  const active = route.page === 'news' && route.query.get('kind') === 'patch' ? 'patches'
    : route.page === 'competitive' && ['compare', 'ranks', 'patch'].includes(route.query.get('view')) ? route.query.get('view')
    : route.page === 'players' && route.param === 'compare' ? 'pvp' : route.page;
  $$('[data-route]').forEach(a => a.classList.toggle('on', a.dataset.route === active));
  $$('[data-sub]').forEach(a => a.classList.toggle('on', route.page === 'competitive' && (route.query.get('queue') || '') === a.dataset.sub));
  $('#sidebar').classList.remove('open');
  $('#menuBtn').setAttribute('aria-expanded', 'false');
  try {
    const mod = await loader();
    await mod.render({ main, route, signal: controller.signal });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="page"><div class="state error"><b>Something went wrong showing this page.</b><p>${esc(e.message)}</p></div></div>`;
  }
  if (!route.query.get('keep')) window.scrollTo({ top: 0 });
}

// shared loaders used by several pages
export async function heroes() {
  const r = await api('/api/heroes', { ttl: 3600_000 });
  setRoster(r.data);
  return r.data;
}
export const maps = () => api('/api/maps', { ttl: 3600_000 });
export const news = (fresh = false) => api('/api/news', { ttl: 10 * 60_000, fresh });

async function boot() {
  const yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();
  await loadManifest();
  // Seed the roster from the asset manifest so names/roles render instantly,
  // then replace with the live roster.
  setRoster(Object.entries(getManifest().heroes).map(([key, v]) => ({ key, name: v.name, role: v.role })));
  heroes().catch(() => {});
  // sidebar artwork: a silhouette of the featured hero (official art, tinted)
  $('#sideArt').innerHTML = heroCutout('sojourn', 'side-cut', 400) || heroCutout('tracer', 'side-cut', 400);

  $('#menuBtn').addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  });
  $('#topSearch').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#topSearchInput');
    const v = input.value.trim();
    if (!v) { input.focus(); return toast('Type a BattleTag, e.g. Name#1234'); }
    input.blur(); // closes the phone keyboard so the result is visible
    go('#/players?q=' + encodeURIComponent(v));
  });
  // Menu links: always close the menu, and re-show the page even if it is the one already open.
  $('#sidebar').addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    $('#sidebar').classList.remove('open');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
    if (!STATIC && a.getAttribute('href') === location.hash) { e.preventDefault(); render(); }
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') $('#sidebar').classList.remove('open'); });
  if (STATIC) return;
  addEventListener('hashchange', render);
  render();
}
boot();
