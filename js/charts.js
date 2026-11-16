// Small hand-built SVG charts (no library). Role colours were validated for the
// dark surface with the dataviz palette checker; roles also carry a distinct
// marker SHAPE (tank ■, damage ▲, support ●) so colour is never the only cue.
import { esc, pct, heroInfo, ROLE_NAME, showTip, hideTip } from './lib.js';

export const ROLE_COLOR = { tank: '#4f8fef', damage: '#ec4f6c', support: '#bf8a1a' };

function marker(role, x, y, r = 5) {
  const c = ROLE_COLOR[role] || '#8a8fb0';
  if (role === 'tank') return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="1.5" fill="${c}" stroke="#121628" stroke-width="2"/>`;
  if (role === 'damage') return `<path d="M${x} ${y - r - 1}L${x + r + 1} ${y + r}H${x - r - 1}Z" fill="${c}" stroke="#121628" stroke-width="2" stroke-linejoin="round"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#121628" stroke-width="2"/>`;
}
export function legend() {
  return `<div class="legend">${Object.keys(ROLE_COLOR).map(r => `<span><svg width="14" height="14" viewBox="0 0 14 14">${marker(r, 7, 7, 4.5)}</svg>${ROLE_NAME[r]}</span>`).join('')}</div>`;
}

const niceTicks = (min, max, n = 4) => {
  const step = Math.max(0.5, Math.ceil(((max - min) / n) * 2) / 2);
  const start = Math.floor(min / step) * step;
  const out = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(+v.toFixed(2));
  return out;
};

/** Pick rate (x) vs win rate (y) for the current dataset. */
export function scatter(rows, { width = 360, height = 220, highlight = [] } = {}) {
  if (!rows?.length) return '';
  const pad = { l: 34, r: 10, t: 18, b: 26 };
  const xs = rows.map(r => r.pickrate), ys = rows.map(r => r.winrate);
  const x0 = 0, x1 = Math.max(...xs) * 1.08;
  const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const X = v => pad.l + ((v - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const Y = v => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const yt = niceTicks(y0, y1), xt = niceTicks(x0, x1);
  const grid = yt.filter(v => v >= y0 && v <= y1).map(v => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pad.l - 6}" y="${Y(v) + 3}" class="tick" text-anchor="end">${v}%</text>`).join('')
    + xt.filter(v => v <= x1).map(v => `<text x="${X(v)}" y="${height - pad.b + 14}" class="tick" text-anchor="middle">${v}%</text>`).join('');
  const fifty = 50 >= y0 && 50 <= y1 ? `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(50)}" y2="${Y(50)}" class="ref"/><text x="${pad.l + 4}" y="${Y(50) + 11}" class="tick">50% win</text>` : '';
  const sorted = [...rows].sort((a, b) => a.pickrate - b.pickrate);
  const labels = new Set([...highlight, ...[...rows].sort((a, b) => b.pickrate - a.pickrate).slice(0, 3).map(r => r.hero)]);
  const placed = [];
  const canLabel = (x, y) => { if (placed.some(p => Math.abs(p[0] - x) < 52 && Math.abs(p[1] - y) < 12)) return false; placed.push([x, y]); return true; };
  const pts = sorted.map(r => {
    const h = heroInfo(r.hero);
    const tipHtml = `<b>${esc(h.name)}</b> · ${esc(ROLE_NAME[h.role] || '')}<br>Pick rate ${pct(r.pickrate)}<br>Win rate ${pct(r.winrate)}${r.banrate != null ? `<br>Ban rate ${pct(r.banrate)}` : ''}`;
    return `<g class="pt" data-tip="${esc(tipHtml)}" data-hero="${esc(r.hero)}"><circle cx="${X(r.pickrate)}" cy="${Y(r.winrate)}" r="11" fill="transparent"/>${marker(h.role, X(r.pickrate), Y(r.winrate), 4.5)}${labels.has(r.hero) && canLabel(X(r.pickrate), Y(r.winrate)) ? (X(r.pickrate) > width * 0.7 ? `<text x="${X(r.pickrate) - 7}" y="${Y(r.winrate) - 6}" class="lbl" text-anchor="end">${esc(h.name)}</text>` : `<text x="${X(r.pickrate) + 7}" y="${Y(r.winrate) - 6}" class="lbl">${esc(h.name)}</text>`) : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Scatter chart of hero pick rate against win rate">${grid}${fifty}<text x="${width - pad.r}" y="${height - 2}" class="axis-title" text-anchor="end">Pick rate →</text><text x="4" y="9" class="axis-title">Win rate ↑</text>${pts}</svg>`;
}

/** Trend lines from stored daily snapshots, for a chosen set of heroes. */
export function trend(snapshots, heroes, metric = 'pickrate', { width = 360, height = 200 } = {}) {
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const days = snapshots.map(s => s.day);
  const series = heroes.map(k => ({ k, h: heroInfo(k), vals: snapshots.map(s => s.rows.find(r => r.hero === k)?.[metric] ?? null) }));
  const all = series.flatMap(s => s.vals).filter(v => v != null);
  if (!all.length) return '';
  const y0 = Math.floor(Math.min(...all) - 1), y1 = Math.ceil(Math.max(...all) + 1);
  const X = i => pad.l + (days.length === 1 ? 0.5 : i / (days.length - 1)) * (width - pad.l - pad.r);
  const Y = v => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const grid = niceTicks(y0, y1).filter(v => v >= y0 && v <= y1).map(v => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pad.l - 6}" y="${Y(v) + 3}" class="tick" text-anchor="end">${v}%</text>`).join('');
  const xl = days.map((d, i) => (i === 0 || i === days.length - 1 || days.length <= 7) ? `<text x="${X(i)}" y="${height - 6}" class="tick" text-anchor="middle">${d.slice(5)}</text>` : '').join('');
  const dash = ['', '5 3', '2 3'];
  const lines = series.map((s, si) => {
    const d = s.vals.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean).join(' L');
    return `<path d="M${d}" fill="none" stroke="${ROLE_COLOR[s.h.role] || '#9aa'}" stroke-width="2" stroke-dasharray="${dash[si % 3]}"/>${s.vals.map((v, i) => v == null ? '' : marker(s.h.role, X(i), Y(v), 3.5)).join('')}`;
  }).join('');
  const cols = days.map((d, i) => {
    const html = `<b>${esc(d)}</b><br>` + series.map(s => `${esc(s.h.name)}: ${pct(s.vals[i])}`).join('<br>');
    const w = (width - pad.l - pad.r) / Math.max(1, days.length - 1);
    return `<rect class="hit" x="${X(i) - w / 2}" y="${pad.t}" width="${w}" height="${height - pad.t - pad.b}" fill="transparent" data-tip="${esc(html)}" data-x="${X(i)}"/>`;
  }).join('');
  return `<svg class="chart trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric} trend from stored daily snapshots">${grid}${xl}<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${height - pad.b}"/>${lines}${cols}</svg>
  <div class="legend">${series.map((s, si) => `<span><svg width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke="${ROLE_COLOR[s.h.role]}" stroke-width="2" stroke-dasharray="${dash[si % 3]}"/></svg>${esc(s.h.name)}</span>`).join('')}</div>`;
}

/** Ring gauge for a single percentage. */
export function ring(value, max = 100, color = '#56d9fb') {
  const r = 22, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, (value || 0) / max));
  return `<svg class="ring" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="${r}" class="ring-bg"/><circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c * v} ${c}" transform="rotate(-90 28 28)"/></svg>`;
}

// Delegated hover for any element with data-tip inside a chart.
document.addEventListener('pointermove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { hideTip(); document.querySelectorAll('.crosshair.on').forEach(c => c.classList.remove('on')); return; }
  showTip(t.dataset.tip, e.clientX, e.clientY);
  const svg = t.closest('svg.trend');
  if (svg && t.dataset.x) { const ch = svg.querySelector('.crosshair'); ch.setAttribute('x1', t.dataset.x); ch.setAttribute('x2', t.dataset.x); ch.classList.add('on'); }
});
document.addEventListener('pointerleave', hideTip);

/**
 * Generic multi-line chart over categorical x labels (e.g. days).
 * series: [{ name, color, dash, shape, values: [number|null per x] }]
 * Identity never relies on colour alone: each line has its own dash + marker
 * shape and a direct label at its last point.
 */
export function lines(xLabels, series, { width = 560, height = 220, yMin, yMax, yTicks, yFmt = v => v, aria = 'Line chart', ref = null, refLabel = '', xStep = 0, marks = [] } = {}) {
  const pad = { l: 64, r: 86, t: 14, b: 24 };
  const all = series.flatMap(s => s.values).filter(v => v != null);
  if (!all.length) return '';
  const withRef = ref == null ? all : [...all, ref];
  const lo = yMin ?? Math.min(...withRef), hi = yMax ?? Math.max(...withRef);
  const y0 = lo === hi ? lo - 1 : lo, y1 = lo === hi ? hi + 1 : hi;
  const X = i => pad.l + (xLabels.length === 1 ? 0.5 : i / (xLabels.length - 1)) * (width - pad.l - pad.r);
  const Y = v => height - pad.b - ((v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const ticks = yTicks || niceTicks(y0, y1).filter(v => v >= y0 && v <= y1).map(v => [v, yFmt(v)]);
  const grid = ticks.map(([v, l]) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pad.l - 6}" y="${Y(v) + 3}" class="tick" text-anchor="end">${esc(l)}</text>`).join('');
  const step = xStep || Math.ceil(xLabels.length / 7);
  const xl = xLabels.map((d, i) => (i % step === 0 || i === xLabels.length - 1) ? `<text x="${X(i)}" y="${height - 6}" class="tick" text-anchor="middle">${esc(d)}</text>` : '').join('');
  const shapeAt = (shape, color, x, y) => shape === 'square' ? `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" fill="${color}" stroke="#121628" stroke-width="2"/>`
    : shape === 'triangle' ? `<path d="M${x} ${y - 5}L${x + 5} ${y + 4}H${x - 5}Z" fill="${color}" stroke="#121628" stroke-width="2"/>`
    : shape === 'diamond' ? `<path d="M${x} ${y - 5}L${x + 5} ${y}L${x} ${y + 5}L${x - 5} ${y}Z" fill="${color}" stroke="#121628" stroke-width="2"/>`
    : `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#121628" stroke-width="2"/>`;
  const refLine = ref == null ? '' : `<line x1="${pad.l}" x2="${width - pad.r}" y1="${Y(ref)}" y2="${Y(ref)}" class="ref"/><text x="${width - pad.r + 6}" y="${Y(ref) + 3}" class="tick">${esc(refLabel)}</text>`;
  // vertical markers at fractional x positions (e.g. a patch released between two saved days)
  const XF = f => pad.l + (xLabels.length === 1 ? 0.5 : f / (xLabels.length - 1)) * (width - pad.l - pad.r);
  const markLines = marks.map(m => `<line x1="${XF(m.at)}" x2="${XF(m.at)}" y1="${pad.t}" y2="${height - pad.b}" class="mark"/><text x="${XF(m.at) + 4}" y="${pad.t + 10}" class="tick mark-lbl">${esc(m.label)}</text>`).join('');
  const body = series.map(s => {
    const pts = s.values.map((v, i) => v == null ? null : [X(i), Y(v)]);
    const segs = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    const last = [...pts].reverse().find(Boolean);
    return segs.map(sg => `<path d="M${sg.map(p => p.join(',')).join(' L')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash || ''}"/>`).join('')
      + pts.map(p => p ? shapeAt(s.shape, s.color, p[0], p[1]) : '').join('')
      + (last ? `<text x="${last[0] + 8}" y="${last[1] + 3}" class="lbl">${esc(s.name)}</text>` : '');
  }).join('');
  const cols = xLabels.map((d, i) => {
    const html = `<b>${esc(d)}</b><br>` + series.map(s => `${esc(s.name)}: ${s.values[i] == null ? '—' : esc(yFmt(s.values[i]))}`).join('<br>');
    const w = (width - pad.l - pad.r) / Math.max(1, xLabels.length - 1);
    return `<rect x="${X(i) - w / 2}" y="${pad.t}" width="${w}" height="${height - pad.t - pad.b}" fill="transparent" data-tip="${esc(html)}" data-x="${X(i)}"/>`;
  }).join('');
  return `<svg class="chart trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">${grid}${xl}<line class="crosshair" x1="0" x2="0" y1="${pad.t}" y2="${height - pad.b}"/>${refLine}${markLines}${body}${cols}</svg>`;
}
export const OPEN_COLOR = '#9a7cf0';
