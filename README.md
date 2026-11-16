# OverScope — Overwatch analytics, made by Figmira Labs

An unofficial fan-made Overwatch stats website: hero meta for Competitive Role Queue and Quick Play, meta by rank, patch impact, maps and objectives, a Stadium build lab, player profiles with a hero deep dive, player-vs-player comparison and official Blizzard news.

**Hosted entirely on GitHub Pages. No server, no accounts, no visitor data stored anywhere.**

## How it works (and why it's private)

| What | Where it comes from | Stored? |
|---|---|---|
| Hero stats, maps, Stadium, player profiles | The visitor's browser asks the public [OverFast API](https://overfast-api.tekrop.fr/docs) directly, live | No. Kept in the browser for a short time only to avoid repeat requests |
| Hero art and map images | Loaded straight from Blizzard's and OverFast's image servers, at the size the page needs | No. Only the image *addresses* are listed in `data/media.json` |
| Blizzard news and patch notes | A GitHub Action copies Blizzard's public news list every 3 hours into `data/news.json`, because browsers aren't allowed to read Blizzard's pages directly | Public Blizzard content only |
| Trend lines and patch impact | The same Action saves one daily copy of Blizzard's public hero-rate tables in `data/history/` | Public, Blizzard-wide averages only. No player or visitor data |
| Meta by rank, hero-by-rank charts, tier lists | The Action saves today's public table for each rank (`data/ranks/`) and each map (`data/map-stats/`), so these pages open instantly | Public averages only |
| Google-visible pages (`/heroes/…`, `/maps/…`, `/tier-list/…`) | Built by the Action from the files above, with preview cards for Discord/X and a `sitemap.xml` | Public content only |
| Favorites, logged matches, viewed-profile rank history | The visitor's own browser (localStorage) | Only on that visitor's device. OverScope never sees it |

Visitors' browsers contact OverFast and Blizzard's image servers directly, so those services see the visitor's IP address and what they look up, as with any website that loads outside content.

---

## Put it on GitHub (step by step)

You only do this once. After that, the site keeps itself up to date.

**1. Create the repository**
- Go to <https://github.com/new>. If you'd like it next to your Figmira website, choose the **Figmira** organization as the owner.
- Name it `overscope`. Set it to **Public**, because free GitHub Pages needs a public repository. Click **Create repository**.

**2. Upload the files.** The easiest way is the free **GitHub Desktop** app (<https://desktop.github.com>):
- In GitHub Desktop, choose File → Clone repository → pick `overscope`, and choose a folder.
- Copy **everything inside** this OverScope folder into that cloned folder. Include the hidden `.github` folder: on a Mac, press **⌘ + Shift + .** in Finder to show hidden files.
- Back in GitHub Desktop, type a summary like "First upload", then click **Commit to main** → **Push origin**.

**3. Turn on GitHub Pages**
- On the repository page, open **Settings → Pages**.
- Under **Build and deployment → Source**, choose **GitHub Actions**.

**4. Run it the first time**
- Open the **Actions** tab, click **Update public data & deploy** → **Run workflow**.
- When it shows a green check (about 1–2 minutes), the site is live at:
  - `https://figmira.github.io/overscope/` if the repository is in the Figmira organization, or
  - `https://YOUR-USERNAME.github.io/overscope/`

From then on it refreshes news every 3 hours, saves one copy of the public hero stats per day, and rebuilds the image list weekly. You don't have to do anything.

### Use your own domain later (e.g. overscope.gg)
1. Buy the domain at a registrar (Namecheap, Cloudflare, GoDaddy…).
2. In **Settings → Pages → Custom domain**, type `overscope.gg` and save.
3. At your registrar, add these DNS records (GitHub's standard Pages addresses):
   - Four **A** records for `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - One **CNAME** record for `www` → `figmira.github.io` (or `YOUR-USERNAME.github.io`)
4. Wait for the check to pass, then tick **Enforce HTTPS**.

GitHub's guide: <https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site>

### Link or embed it on figmira.com
- **Link:** `<a href="https://figmira.github.io/overscope/">OverScope — Overwatch analytics</a>`
- **Embed:** `<iframe src="https://figmira.github.io/overscope/" title="OverScope" style="width:100%;height:900px;border:0;border-radius:12px" loading="lazy"></iframe>`

---

## Files

```
index.html, css/, js/, fonts/   the website (plain HTML/CSS/JavaScript)
js/data.js                      all data fetching, checks and caching (runs in the browser)
js/tiers.js                     the tier-list rules (shared by the app and the Google pages)
js/safe.js                      checks every outside link/image address before it is shown
data/news.json                  public Blizzard news (written by the Action)
data/history/                   daily public hero-rate tables (written by the Action)
data/media.json                 official image addresses (written by the Action)
data/ranks/, data/map-stats/    today's public tables per rank / per map (written by the Action)
data/catalog.json               public hero & map descriptions (written by the Action)
data/modes.json                 plain-English scoring rules for each game mode
scripts/update-data.mjs         refreshes data/ (the Action runs it every 3 hours)
site.config.json                tip link and ads switches (both off)
scripts/build-site.mjs          builds _site/: the app + Google-visible pages + sitemap (the Action runs it)
scripts/browser-check.mjs       real-browser test of every page (optional)
.github/workflows/              the GitHub Action
docs/                           test results, screenshots, sources
```

## Preview it on your Mac (optional)
You don't need to. But if you want to look before uploading, open Terminal in this folder and run `npm run preview`. Then open <http://localhost:8000>.

## Known limitations
- **Open Queue hero stats** aren't published by any verified source, so the site doesn't offer that queue (a player's own Open Queue rank still shows when they have one).
- **Global map popularity** isn't published by Blizzard.
- **Trend lines and patch impact** start on the day the Action first runs, and grow one point per day.
- **Player rank history** is per browser: it records the days a profile was opened on that device.
- **Tier lists** are calculated from Blizzard's pick and win rates only (method shown on the page). Blizzard publishes no game counts, so a tier is a summary, not a verdict.
- **Google pages** are published for Role Queue · PC · Americas. The live app covers every platform, region and queue.
- **Hero portraits** are about 160 KB each on Blizzard's server and can't be requested smaller, so pages that show all 54 heroes are heavy on phones.
- **Champion** has no separate hero-rates table, so the rank filter stops at Grandmaster.
- **Grímsvötn and Neon Junction** have no working screenshot upstream, so they show a labelled placeholder.
- **Private profiles** can't be unlocked, even with a Battle.net login. Blizzard's login gives no Overwatch data.
- **Upstream changes:** OverFast is a free community service. If it's down, pages show a clear error. If Blizzard redesigns its news pages, the news parser needs an update. The Action keeps the last good copy until then.

## Turning on tips or ads (both are off)
Everything is controlled by **`site.config.json`**. Edit it on GitHub (open the file → pencil icon → *Commit changes*). The Action rebuilds the site in a few minutes.

**Tip link:** paste your page address into `"url"`, for example `"url": "https://ko-fi.com/yourname"`. A "♥ Support OverScope" link then appears in the sidebar and footer. Only Ko-fi, Buy Me a Coffee, GitHub Sponsors, Patreon and Liberapay addresses are accepted. Tips should stay pure gifts: don't unlock features for supporters.

**Ads:** pick a network first (it will give you its code and the web addresses it loads from). Then fill in:
- `"enabled": true`
- `"network"`: its name
- `"hosts"`: the addresses it loads from, e.g. `["https://ads.example.com"]`
- `"headHtml"`: the code it says goes in `<head>`
- `"slotHtml"`: the code for one ad box (shown above the footer on every page)
- `"consentReady": true`, but only once a cookie-consent pop-up is set up. Ads track visitors, so the build refuses to switch them on without this.

When ads are on, the security policy automatically allows that network, and the Privacy section tells visitors the site shows ads. If something in the file is wrong, the build stops and the live site stays as it was.

## Security
- A Content-Security-Policy in every page only lets the browser run the site's own code, load pictures from Blizzard/OverFast, and fetch data from OverFast.
- Every address that comes from outside (player banners, news links, thumbnails) is checked before use (`js/safe.js`, covered by unit tests).
- The GitHub Action pins each building block to an exact version and gives each step only the permissions it needs. Nothing secret is stored.
- GitHub Pages can't send security headers, so the site can be framed by other sites (this is also what lets figmira.com embed it). The site has no logins or account actions, so this carries little risk.

## Rights
Overwatch and all hero and map artwork are © Blizzard Entertainment. OverScope is an unofficial fan project by [Figmira Labs](https://figmira.com), not affiliated with or endorsed by Blizzard. Artwork is displayed from Blizzard's own servers and isn't redistributed. Review Blizzard's fan-content policy before promoting the site widely.
