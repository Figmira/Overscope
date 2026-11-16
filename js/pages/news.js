import { $, esc, icon, errorBox, loadingBox, emptyBox, fmtDate, timeAgo, relay, safeLink } from '../lib.js';
import { news as loadNews, go } from '../app.js';

export async function render({ main, route, signal }) {
  const kind = ['patch', 'news'].includes(route.query.get('kind')) ? route.query.get('kind') : 'all';
  main.innerHTML = `<div class="page">
    <header class="page-top"><p class="eyebrow">Blizzard · official content</p><h1>The latest <em>from Blizzard</em></h1><p>Patch notes and news copied from Blizzard's official pages by OverScope's update job every 3 hours. Every item opens the original article.</p></header>
    <div class="toolbar"><div class="seg big">${[['all', 'All updates'], ['patch', 'Patch notes'], ['news', 'News & features']].map(([k, v]) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${v}</button>`).join('')}</div><button class="btn sm" id="refresh">Refresh now</button><span class="count" id="newsStamp"></span></div>
    <div class="two wide-left"><section class="panel" id="newsList">${loadingBox(6)}</section>
    <aside class="col"><section class="panel"><div class="prose"><h3>Official sources only</h3><p>Headlines come from Blizzard's <a href="https://overwatch.blizzard.com/en-us/news/" target="_blank" rel="noopener">Overwatch news</a>, <a href="https://overwatch.blizzard.com/en-us/news/patch-notes/" target="_blank" rel="noopener">patch notes</a> and <a href="https://news.blizzard.com/en-us/feed/overwatch" target="_blank" rel="noopener">Blizzard News</a>. Nothing is hard-coded: if Blizzard can't be reached, this page says so.</p></div></section><section class="panel" id="newsStatus"></section></aside></div></div>`;
  main.addEventListener('click', e => { const k = e.target.closest('[data-kind]'); if (k) go('#/news' + (k.dataset.kind === 'all' ? '' : '?kind=' + k.dataset.kind)); }, { signal });
  $('#refresh').addEventListener('click', () => draw(true), { signal });

  async function draw(fresh = false) {
    $('#newsList').innerHTML = loadingBox(6);
    try {
      const n = await loadNews(fresh);
      const items = kind === 'patch' ? n.patches : kind === 'news' ? n.news : [...n.patches.slice(0, 3), ...n.news].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      $('#newsStamp').textContent = `Checked ${timeAgo(n.checkedAt)}${n.stale ? ' · some sources are saved copies' : ''}`;
      $('#newsList').innerHTML = `<header class="panel-head"><h2>${icon('i-news')}${kind === 'patch' ? 'Patch notes' : kind === 'news' ? 'News & features' : 'Latest updates'}</h2><small class="muted">${items.length} items</small></header>` + (items.length ? `<ul class="news-list">${items.map(it => `<li><a href="${esc(safeLink(it.url))}" target="_blank" rel="noopener">
        <span class="news-img">${relay(it.image) ? `<img class="os-img" src="${esc(relay(it.image))}" alt="" loading="lazy" data-fallback="${it.kind === 'patch' ? 'PATCH NOTES' : 'NEWS'}" data-role="news">` : `<span class="img-fallback role-news">${it.kind === 'patch' ? 'PATCH<br>NOTES' : 'NEWS'}</span>`}</span>
        <span><span class="badge ${it.kind === 'patch' ? 'gold' : ''}">${it.kind === 'patch' ? 'Patch notes' : 'News'}</span><b>${esc(it.title)}</b>${it.summary ? `<p>${esc(it.summary)}</p>` : ''}<small>${it.date ? esc(fmtDate(it.date)) + ' · ' : ''}${esc(it.source)} ${icon('i-ext')}</small></span></a></li>`).join('')}</ul>`
        : emptyBox('Nothing to show', 'Blizzard\'s pages were reached but no items could be read. Open the official pages directly below.', '<a class="btn sm" href="https://overwatch.blizzard.com/en-us/news/patch-notes/" target="_blank" rel="noopener">Patch notes on Blizzard</a>'));
      $('#newsStatus').innerHTML = `<header class="panel-head"><h2>${icon('i-info')}Feed status</h2></header><ul class="status-list">${n.sources.map(s => `<li class="${s.error && !s.items ? 'bad' : s.stale ? 'warn' : 'ok'}"><b>${esc(new URL(s.url).host + new URL(s.url).pathname)}</b><small>${s.items} items${s.fetchedAt ? ' · fetched ' + esc(timeAgo(s.fetchedAt)) : ''}${s.error ? ' · ' + esc(s.error) : ''}</small></li>`).join('')}</ul>`;
    } catch (e) { $('#newsList').innerHTML = errorBox(e); }
  }
  draw();
}
