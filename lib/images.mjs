// Image helpers shared by the asset pipeline and the on-demand image relay.
// Verifies real bytes (magic numbers) and reads dimensions without any library.

export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (buf.toString('ascii', 4, 12) === 'ftypavif') return 'avif';
  if (/^\s*<(\?xml|svg)/i.test(buf.toString('utf8', 0, 100))) return 'svg';
  return null;
}

export function dimensions(buf, type = sniff(buf)) {
  try {
    if (type === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'jpg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (type === 'webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
  } catch { /* fall through */ }
  return null;
}

export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' };

/** Hosts we are willing to relay images from (official / API-provided media only). */
export const IMAGE_HOSTS = [
  'd15f34w2p8l1cc.cloudfront.net',
  'blz-contentstack-images.akamaized.net',
  'overfast-api.tekrop.fr',
  'overwatch.blizzard.com',
  'static.playoverwatch.com',
  'bnetcmsus-a.akamaihd.net',
];
export const hostAllowed = h => IMAGE_HOSTS.some(x => h === x || h.endsWith('.' + x));

/**
 * Bounding box of the non-transparent pixels in an 8-bit RGBA / grey+alpha PNG,
 * as fractions [x0, y0, x1, y1]. Lets the site crop empty space around cutouts.
 * Returns null for formats it does not handle (then the full image is used).
 */
export async function alphaBBox(buf) {
  const { inflateSync } = await import('node:zlib');
  if (sniff(buf) !== 'png') return null;
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], ctype = buf[25], interlace = buf[28];
  const bpp = ctype === 6 ? 4 : ctype === 4 ? 2 : 0;
  if (!bpp || depth !== 8 || interlace) return null;
  const parts = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') parts.push(buf.subarray(i + 8, i + 8 + len));
    if (type === 'IEND') break;
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = w * bpp;
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      if (cur[x * bpp + bpp - 1] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    [prev, cur] = [cur, prev];
  }
  if (x1 < 0) return null;
  const r = v => Math.round(v * 1000) / 1000;
  return [r(x0 / w), r(y0 / h), r((x1 + 1) / w), r((y1 + 1) / h)];
}
