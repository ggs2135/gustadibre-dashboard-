# Gusta-dibre Critical Mineral Dashboard

A daily news dashboard for critical-minerals, mining, and lab-instrumentation
news, published as a static site on GitHub Pages. No API key, no paid service —
it's built entirely on free public RSS feeds.

## How it works

- `scripts/fetch-news.mjs` pulls headlines from a curated list of RSS feeds
  (mining trade press, chemistry news, R&D/funding news), sorts each item into
  a category and mineral/topic tag by keyword matching, and writes the result
  to `public/news.json`.
- `src/App.jsx` is a static React app that just reads `news.json`.
- Two GitHub Actions do the work:
  - **Fetch News** (`.github/workflows/fetch-news.yml`) — runs on a daily cron
    (07:00 UTC by default — edit the `cron` line to change it), runs the
    script, and commits the updated `public/news.json`.
  - **Deploy** (`.github/workflows/deploy.yml`) — runs on every push to `main`
    (including the daily commit above), builds the site with Vite, and
    publishes it to GitHub Pages.

Because this is keyword-based rather than AI-summarized, each card shows the
feed's own headline/excerpt plus a "Read full story →" link to the source —
there's no synthesized summary or deep-dive, and category/tag matching is
approximate (it can occasionally misfile a story).

## One-time setup

1. Install dependencies and confirm it builds locally:
   ```bash
   npm install
   npm run dev        # http://localhost:5173
   ```
2. Push this repo to GitHub (create an empty repo on GitHub first, then):
   ```bash
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
3. Enable Pages: repo **Settings → Pages → Source: GitHub Actions**.
4. Generate the first briefing: **Actions tab → Fetch News → Run workflow**.
   Once it finishes (it commits `public/news.json`), the **Deploy** workflow
   fires automatically and publishes the site.
5. Your dashboard link is `https://<username>.github.io/<repo-name>/` — that's
   the one to bookmark / set as a new-tab page.

## Customizing

- Categories, colors, and the mineral/topic dropdown list live at the top of
  `src/App.jsx` (`CATEGORIES`, `MINERAL_TAGS`).
- The RSS feed list, category keyword rules, and mineral tag list live in
  `scripts/fetch-news.mjs` (`FEEDS`, `CATEGORY_RULES`, `MINERAL_TAGS`) — add a
  feed by appending `{ url, source }`; add `requireKeywordMatch: true` for a
  general-interest feed that needs filtering down to on-topic stories.
- To fetch more/less often, edit the `cron` schedule in
  `.github/workflows/fetch-news.yml`.
- To test the fetch script locally: `npm run fetch-news`.
