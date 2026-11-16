import { $, esc, api, heroInfo, heroPortrait, heroArt, icon, roleIcon, errorBox, loadingBox, emptyBox, relay, toast, ROLE_NAME, roster } from '../lib.js';
import { heroes as loadHeroes, go } from '../app.js';

const MAX_POWERS = 4, MAX_ITEMS = 6;

export async function render({ main, route, signal }) {
  await loadHeroes().catch(() => {});
  let stadiumRoster = null, rosterNote = '';
  try { const r = await api('/api/heroes?gamemode=stadium', { ttl: 3600_000 }); stadiumRoster = r.data; if (!r.data) rosterNote = r.unavailable; } catch (e) { rosterNote = e.message; }
  const list = (stadiumRoster || roster()).slice().sort((a, b) => a.name.localeCompare(b.name));
  const key = route.param || list.find(h => h.key === 'tracer')?.key || list[0]?.key || 'tracer';
  const picked = { powers: (route.query.get('p') || '').split('|').filter(Boolean), items: (route.query.get('i') || '').split('|').filter(Boolean) };
  const h = heroInfo(key);

  main.innerHTML = `<div class="page">
    <header class="page-top stadium-top"><p class="eyebrow">Stadium · build lab</p><h1>Build. Compete. <em>Evolve.</em></h1><p>Browse each hero's official Stadium powers, pick your ${MAX_POWERS}, then share the build or export it.</p></header>
    <div class="stadium-layout">
      <aside class="panel st-roster"><header class="panel-head"><h2>${icon('i-group')}Stadium roster</h2><small class="muted">${stadiumRoster ? stadiumRoster.length + ' heroes' : 'full roster'}</small></header>
        ${!stadiumRoster ? `<p class="source-note warn">Stadium-only roster filter unavailable${rosterNote ? ' (' + esc(rosterNote) + ')' : ''}; showing all heroes. Some may not be playable in Stadium.</p>` : ''}
        <div class="st-list">${list.map(x => `<a href="#/stadium/${esc(x.key)}" class="${x.key === key ? 'on' : ''}" aria-current="${x.key === key}">${heroPortrait(x.key, 'mini')}<span class="nm">${esc(x.name)}</span>${roleIcon(x.role)}</a>`).join('')}</div></aside>
      <div class="st-main">
        <section class="st-hero role-${esc(h.role)}"><div class="st-art">${heroArt(key, 'st-img')}</div><div class="st-shade"></div><div class="st-copy"><p class="eyebrow">${roleIcon(h.role)} ${esc(ROLE_NAME[h.role] || '')}</p><h2>${esc(h.name)}</h2><div id="buildBox"></div></div></section>
        <section class="panel" id="powers">${loadingBox(6)}</section>
        <section class="panel" id="items" hidden></section>
        <section class="panel"><div class="prose"><h3>Data availability</h3><p>Power names and descriptions come from Blizzard's official hero pages (via the OverFast API). Blizzard does not publish Stadium items, or build pick and win rates, so OverScope does not show them. Your builds are stored only in the link you share.</p></div></section>
      </div>
    </div></div>`;

  let data = null;
  try { data = (await api('/api/heroes/' + key, { ttl: 3600_000 })).data.stadium; } catch (e) { $('#powers').innerHTML = errorBox(e); }
  // Items appear only if a verified source ever provides them (none does today).
  const hasItems = () => !!data?.items?.length;
  const drawBuild = () => {
    $('#buildBox').innerHTML = `<div class="build"><div><small>Powers ${picked.powers.length}/${MAX_POWERS}</small><div class="slots">${Array.from({ length: MAX_POWERS }, (_, i) => `<span class="slot ${picked.powers[i] ? 'full' : ''}">${esc(picked.powers[i] || 'Empty')}</span>`).join('')}</div></div>
      ${hasItems() ? `<div><small>Items ${picked.items.length}/${MAX_ITEMS}</small><div class="slots">${Array.from({ length: MAX_ITEMS }, (_, i) => `<span class="slot ${picked.items[i] ? 'full' : ''}">${esc(picked.items[i] || 'Empty')}</span>`).join('')}</div></div>` : ''}
      <div class="cta"><button class="btn sm primary" data-act="share">Copy share link</button><button class="btn sm" data-act="text">Copy as text</button><button class="btn sm" data-act="json">Export JSON</button><button class="btn sm ghost" data-act="clear">Clear</button></div></div>`;
  };
  const drawLists = () => {
    if (!data) return;
    $('#powers').innerHTML = `<header class="panel-head"><h2>${icon('i-stadium')}Powers<small>— pick up to ${MAX_POWERS}</small></h2></header>` + (data.powers.length
      ? `<div class="power-grid">${data.powers.map((p, i) => `<button class="power ${picked.powers.includes(p.name) ? 'on' : ''}" aria-pressed="${picked.powers.includes(p.name)}" data-power="${esc(p.name)}">${p.icon ? `<img src="${esc(relay(p.icon))}" alt="" width="40" height="40" loading="lazy">` : `<span class="pnum">${String(i + 1).padStart(2, '0')}</span>`}<span><b>${esc(p.name)}</b><span>${esc(p.description)}</span></span></button>`).join('')}</div>`
      : emptyBox('No Stadium powers in the data source', `The hero data for ${esc(h.name)} did not include Stadium powers. This happens if the hero is not in Stadium or the source has not added them yet.`));
    $('#items').hidden = !hasItems();
    $('#items').innerHTML = hasItems() ? `<header class="panel-head"><h2>${icon('i-bars')}Hero items<small>— pick up to ${MAX_ITEMS}</small></h2></header><div class="power-grid items">${data.items.map(p => `<button class="power ${picked.items.includes(p.name) ? 'on' : ''}" aria-pressed="${picked.items.includes(p.name)}" data-item="${esc(p.name)}">${p.icon ? `<img src="${esc(relay(p.icon))}" alt="" width="36" height="36" loading="lazy">` : ''}<span><b>${esc(p.name)}${p.cost ? ` <em>${esc(p.cost.toLocaleString())}</em>` : ''}</b><span>${esc(p.description)}</span></span></button>`).join('')}</div>` : '';
  };
  drawBuild(); drawLists();
  if (!hasItems()) picked.items.length = 0;

  const shareUrl = () => `${location.href.split('#')[0]}#/stadium/${key}?` + new URLSearchParams({ p: picked.powers.join('|'), ...(picked.items.length ? { i: picked.items.join('|') } : {}) }).toString();
  const text = () => `OverScope Stadium build — ${h.name}\nPowers: ${picked.powers.join(', ') || '—'}${picked.items.length ? `\nItems: ${picked.items.join(', ')}` : ''}\n${shareUrl()}`;
  const copy = async s => { try { await navigator.clipboard.writeText(s); toast('Copied to clipboard'); } catch { prompt('Copy this:', s); } };
  const syncUrl = () => history.replaceState(null, '', `#/stadium/${key}?` + new URLSearchParams({ p: picked.powers.join('|'), ...(picked.items.length ? { i: picked.items.join('|') } : {}), keep: '1' }).toString());

  main.addEventListener('click', e => {
    const p = e.target.closest('[data-power]'), it = e.target.closest('[data-item]'), a = e.target.closest('[data-act]');
    if (p || it) {
      const [arr, max, name] = p ? [picked.powers, MAX_POWERS, p.dataset.power] : [picked.items, MAX_ITEMS, it.dataset.item];
      const i = arr.indexOf(name);
      if (i >= 0) arr.splice(i, 1); else if (arr.length < max) arr.push(name); else return toast(`A build holds ${max} ${p ? 'powers' : 'items'}. Remove one first.`);
      drawBuild(); drawLists(); syncUrl(); return;
    }
    if (!a) return;
    if (a.dataset.act === 'clear') { picked.powers.length = 0; picked.items.length = 0; drawBuild(); drawLists(); syncUrl(); }
    if (a.dataset.act === 'share') copy(shareUrl());
    if (a.dataset.act === 'text') copy(text());
    if (a.dataset.act === 'json') {
      const blob = new Blob([JSON.stringify({ hero: key, name: h.name, powers: picked.powers, items: picked.items, createdAt: new Date().toISOString(), source: 'OverScope' }, null, 2)], { type: 'application/json' });
      const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `overscope-stadium-${key}.json`; el.click(); setTimeout(() => URL.revokeObjectURL(el.href), 1000);
    }
  }, { signal });
}
