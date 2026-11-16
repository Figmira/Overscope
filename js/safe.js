// URL checks for anything that comes from outside the site (OverFast, scraped
// Blizzard pages). Pure functions so they can be unit-tested in Node.

/** Image hosts the site is allowed to show pictures from (mirrors the page's security policy). */
export const IMAGE_HOSTS = new Set([
  'blz-contentstack-images.akamaized.net', 'blz-contentstack-assets.akamaized.net',
  'd15f34w2p8l1cc.cloudfront.net', 'overfast-api.tekrop.fr', 'static.playoverwatch.com',
  'bnetcmsus-a.akamaihd.net', 'overwatch.blizzard.com',
]);
/** Remote images from upstream data: only https, only known Blizzard/OverFast hosts. */
export function relay(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && IMAGE_HOSTS.has(u.hostname) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
/** Outbound links from scraped news: https on Blizzard sites only, otherwise the news hub. */
export function safeLink(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && /(^|\.)blizzard\.com$/.test(u.hostname) ? u.href : 'https://overwatch.blizzard.com/en-us/news/';
  } catch { return 'https://overwatch.blizzard.com/en-us/news/'; }
}
/** A validated image URL that is safe to place inside CSS url("…"). */
export function cssUrl(url) {
  const safe = relay(url);
  return safe ? `url("${safe.replace(/[\s"'()\\<>]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}")` : '';
}

