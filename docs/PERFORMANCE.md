# Performance (v2.1)

Measured in Chrome via Playwright on the built site. Phone = 390×844, simulated slow 4G (1.6 Mbps, 150 ms latency) and 4× slower CPU. LCP = when the main content appears; CLS = how much the page jumps (under 0.1 is good).

| Device | Page | LCP | CLS | Downloaded |
|---|---|---|---|---|
| Desktop | Home | 1.3 s | 0.002 | 3.14 MB |
| Desktop | Tier list (app) | 1.0 s | 0.001 | 9.25 MB |
| Desktop | Hero page (app) | 0.9 s | 0.038 | 0.52 MB |
| Desktop | Meta by rank | 0.9 s | 0.000 | 6.74 MB |
| Desktop | Heroes grid | 1.4 s | 0.001 | 9.24 MB |
| Desktop | Google page: hero | 0.6 s | 0.001 | 0.39 MB |
| Desktop | Google page: tier list | 0.2 s | 0.007 | 9.23 MB |
| Phone (slow 4G) | Home | 4.5 s | 0.020 | 2.41 MB |
| Phone (slow 4G) | Tier list (app) | 3.1 s | 0.008 | 9.25 MB |
| Phone (slow 4G) | Hero page (app) | 3.3 s | 0.050 | 0.49 MB |
| Phone (slow 4G) | Meta by rank | 3.1 s | 0.002 | 0.43 MB |
| Phone (slow 4G) | Heroes grid | 7.4 s | 0.012 | 2.62 MB |
| Phone (slow 4G) | Google page: hero | 1.2 s | 0.002 | 0.36 MB |
| Phone (slow 4G) | Google page: tier list | 1.1 s | 0.029 | 9.23 MB |
| Phone (slow 4G) | Google page: map | 2.7 s | 0.002 | 0.52 MB |

Notes:
- Pages that show all 54 heroes (Heroes grid, tier lists) download ~9 MB because Blizzard's portraits are ~160 KB each and can't be requested smaller. Text and layout appear in 1–3 s; portraits fill in after.
- Meta by rank and hero-by-rank charts now read a daily saved copy (8 tables in one small file) instead of 8 live requests.
- Map pages no longer show portraits in their tier list: phone load went from 26.5 s to 2.7 s.
