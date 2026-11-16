// Official Blizzard news + patch notes, parsed server-side and cached.
// Nothing here is hard-coded: if Blizzard cannot be reached and no earlier copy
// exists, the API says so instead of inventing "current" headlines.
// Pure parsing helpers for Blizzard's public news + patch-note pages (used by the GitHub Action).
const BLIZZARD = 'https://overwatch.blizzard.com';

export const NEWS_URL = `${BLIZZARD}/en-us/news/`;
export const PATCH_URL = `${BLIZZARD}/en-us/news/patch-notes/`;
export const BNET_NEWS_URL = 'https://news.blizzard.com/en-us/feed/overwatch';
const TTL = 30 * 60_000;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…' };
export function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export const clean = s => decode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3]) : '';
};

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_RE = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`);
export function parseDate(text) {
  const m = DATE_RE.exec(text || '');
  if (m) { const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00:00 UTC`); if (!isNaN(d)) return d.toISOString().slice(0, 10); }
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})/.exec(text || '');
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

/** Patch notes page: each patch is a block with a title containing its date. */
export function parsePatchNotes(html, pageUrl = PATCH_URL) {
  const out = [];
  const seen = new Set();
  // Strategy 1: element ids such as id="patch-2026-11-05"
  const idRe = /id\s*=\s*["']patch-(\d{4}-\d{2}-\d{2})["']/gi;
  let m;
  const anchors = [];
  while ((m = idRe.exec(html))) anchors.push({ date: m[1], at: m.index });
  for (let i = 0; i < anchors.length; i++) {
    const chunk = html.slice(anchors[i].at, anchors[i + 1]?.at ?? anchors[i].at + 20000);
    const t = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i.exec(chunk);
    const title = t ? clean(t[1]) : `Overwatch Patch Notes – ${anchors[i].date}`;
    const sections = [...chunk.matchAll(/<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>/gi)].map(x => clean(x[1])).filter(x => x && x !== title).slice(0, 6);
    if (seen.has(anchors[i].date)) continue;
    seen.add(anchors[i].date);
    out.push({
      kind: 'patch', title, date: anchors[i].date,
      summary: sections.length ? 'Covers: ' + sections.join(' · ') : 'Official Overwatch patch notes.',
      url: `${pageUrl}#patch-${anchors[i].date}`, image: '', source: 'Blizzard · Patch notes',
    });
  }
  // Strategy 2: headings that read "... Patch Notes – Month D, YYYY"
  if (!out.length) {
    for (const h of html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
      const title = clean(h[1]);
      if (!/patch notes/i.test(title)) continue;
      const date = parseDate(title);
      if (!date || seen.has(date)) continue;
      seen.add(date);
      out.push({ kind: 'patch', title, date, summary: 'Official Overwatch patch notes.', url: PATCH_URL, image: '', source: 'Blizzard · Patch notes' });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

/** News listing: find article links (/news/<id>/<slug>/) and the card around them. */
export function parseNewsList(html, base = NEWS_URL) {
  const out = [];
  const seen = new Set();
  const linkRe = /<(a|blz-card|blz-news-card|div)\b[^>]*href\s*=\s*["']([^"']*\/news\/(\d{6,})\/[^"']*)["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    let url;
    try { url = new URL(decode(m[2]), base); } catch { continue; }
    if (!/blizzard\.com$/.test(url.hostname) || url.pathname.includes('/patch-notes')) continue;
    const id = m[3];
    if (seen.has(id)) continue;
    const tag = m[0];
    const closeIdx = html.indexOf(`</${m[1]}>`, m.index);
    const body = html.slice(m.index, closeIdx > 0 && closeIdx - m.index < 6000 ? closeIdx : m.index + 4000);
    const heading = /<(h[1-6]|[a-z-]*heading[a-z-]*)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body) || /slot=["']heading["'][^>]*>([\s\S]*?)</i.exec(body);
    let title = heading ? clean(heading[2] ?? heading[1]) : '';
    if (!title) title = attr(tag, 'title') || attr(tag, 'aria-label') || clean(body).slice(0, 120);
    if (!title || title.length < 8) continue;
    const imgTag = /<(img|blz-image)\b[^>]*>/i.exec(body);
    let image = imgTag ? (attr(imgTag[0], 'src') || attr(imgTag[0], 'data-src')) : (attr(tag, 'image') || attr(tag, 'thumbnail'));
    if (image.startsWith('//')) image = 'https:' + image;
    const desc = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body) || /slot=["']description["'][^>]*>([\s\S]*?)</i.exec(body);
    const ts = /timestamp\s*=\s*["'](\d{4}-\d{2}-\d{2})/i.exec(body);
    const date = (ts && ts[1]) || parseDate(attr(tag, 'date') || attr(tag, 'publish-date') || clean(body)) || (/datetime=["']([^"']+)["']/i.exec(body)?.[1] || '').slice(0, 10);
    seen.add(id);
    out.push({
      kind: /patch notes/i.test(title) ? 'patch' : 'news', title, date,
      summary: desc ? clean(desc[1]).slice(0, 240) : '',
      url: url.toString(), image, source: url.hostname === 'news.blizzard.com' ? 'Blizzard News' : 'Overwatch.com news',
    });
    if (out.length >= 24) break;
  }
  return out;
}

