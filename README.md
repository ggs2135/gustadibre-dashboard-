# Gusta-dibre Critical Mineral Dashboard

A daily dashboard for critical-minerals news, academic papers, podcast
episodes, and spot metal prices, published as a static site on GitHub Pages.
Everything is fetched by scheduled scripts and committed as static JSON —
the deployed frontend never calls any API or holds any credential.

## Sections

- **Podcasts** — latest episode + Spotify link for five shows (Café da Manhã,
  Posse de Bola, WSJ What's News, Chain Reaction by ACS, Stereo Chemistry),
  with a "NEW" badge for anything released in the last 3 days.
- **Spot prices** — silver, platinum, palladium, rhodium (USD/troy oz), via
  MetalpriceAPI.
- **News** — critical-minerals news from the last 3 days: technology,
  politics/policy, funding, and markets. Sources: NYT Article Search API,
  plus RSS from NPR, WSJ, G1, MINING.com, International Mining, Northern
  Miner, Canadian Mining Journal, R&D World, Phys.org Chemistry, and
  Crunchbase News.
- **Papers** — academic papers from the last 6 months via OpenAlex (primary)
  and Semantic Scholar (secondary, best-effort). Google Scholar has no public
  API, and the New York Public Library's API is a catalog of digitized
  historical materials, not current journal content — neither is usable here.

Everything is keyword/filter-based rather than AI-summarized: headlines keep
the source's own text, category/tag matching is approximate, and a given
run can come back with zero items for a section (expected — not a bug).

## How it works

- `scripts/fetch-news.mjs` — RSS + NYT API → `public/news.json`.
- `scripts/fetch-podcasts.mjs` — scrapes each show's public Spotify embed
  page (`open.spotify.com/embed/show/<id>`) for its latest episode. No login,
  no API key — Spotify's Web API gates episode listing behind a 250k-MAU
  "Extended Quota Mode" that a personal project will never reach, so the
  embed page's own `__NEXT_DATA__` JSON is the reliable free path. →
  `public/podcasts.json`.
- `scripts/fetch-papers.mjs` — OpenAlex + Semantic Scholar →
  `public/papers.json`.
- `scripts/fetch-prices.mjs` — MetalpriceAPI → `public/prices.json`.
- `src/App.jsx` is a static React app that just reads those four JSON files.
- Two GitHub Actions do the work:
  - **Fetch News** (`.github/workflows/fetch-news.yml`) — runs on a daily cron
    (07:00 UTC by default), runs all four fetch scripts, and commits the
    updated JSON files.
  - **Deploy** (`.github/workflows/deploy.yml`) — runs on every push to `main`
    (including the daily commit above), builds the site with Vite, and
    publishes it to GitHub Pages.

## One-time setup

1. Install dependencies and confirm it builds locally:
   ```bash
   npm install
   npm run dev        # http://localhost:5173
   ```
2. Get free API keys and put them in a local `.env` (gitignored, never
   committed):
   - **NYT_API_KEY** — free at [developer.nytimes.com](https://developer.nytimes.com/get-started),
     enable the Article Search API.
   - **METALPRICE_API_KEY** — free at [metalpriceapi.com](https://metalpriceapi.com),
     no card required. Omit this (leave it blank) to skip the price section —
     it just won't render.
3. Push this repo to GitHub (create an empty repo on GitHub first, then):
   ```bash
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
4. Add the same two keys as repo secrets: **Settings → Secrets and variables →
   Actions → New repository secret** (`NYT_API_KEY`, `METALPRICE_API_KEY`).
5. Enable Pages: repo **Settings → Pages → Source: GitHub Actions**.
6. Generate the first briefing: **Actions tab → Fetch News → Run workflow**.
   Once it finishes (it commits the four JSON files), the **Deploy** workflow
   fires automatically and publishes the site.
7. Your dashboard link is `https://<username>.github.io/<repo-name>/` — that's
   the one to bookmark / set as a new-tab page.

## Customizing

- Categories, colors, and the mineral/topic dropdown list live at the top of
  `src/App.jsx` (`CATEGORIES`, `MINERAL_TAGS`).
- The RSS feed list, NYT queries, category keyword rules, and mineral tag
  list live in `scripts/fetch-news.mjs` (`FEEDS`, `NYT_QUERIES`,
  `CATEGORY_RULES`, `MINERAL_TAGS`) — add a feed by appending
  `{ url, source }`; add `requireKeywordMatch: true` for a general-interest
  feed that needs filtering down to on-topic stories.
- The tracked podcasts live in `scripts/fetch-podcasts.mjs` (`SHOWS`) — add a
  show by appending `{ name, spotifyId }` (the id from its
  `open.spotify.com/show/<id>` URL).
- The paper search topics live in `scripts/fetch-papers.mjs` (`TOPICS`).
- The tracked metals live in `scripts/fetch-prices.mjs` (`METALS`).
- To fetch more/less often, edit the `cron` schedule in
  `.github/workflows/fetch-news.yml`.
- To test a fetch script locally: `npm run fetch-news`, `npm run
  fetch-podcasts`, `npm run fetch-papers`, `npm run fetch-prices`, or `npm run
  fetch-all` for all four.
