# Critical Minerals Daily Briefing

A daily news dashboard for critical-minerals + lab-instrumentation news, published
as a static site on GitHub Pages.

## How it works

- `scripts/fetch-news.mjs` calls the Anthropic API (with the web search tool)
  **server-side**, once a day, and writes the results to `public/news.json`.
- `src/App.jsx` is a static React app that just reads `news.json` — it never
  calls the Anthropic API from the browser, so the API key is never exposed.
- Two GitHub Actions do the work:
  - **Fetch News** (`.github/workflows/fetch-news.yml`) — runs on a daily cron
    (07:00 UTC by default — edit the `cron` line to change it), calls the
    script, and commits the updated `public/news.json`.
  - **Deploy** (`.github/workflows/deploy.yml`) — runs on every push to `main`
    (including the daily commit above), builds the site with Vite, and
    publishes it to GitHub Pages.

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
3. Add your Anthropic API key as a secret: repo **Settings → Secrets and
   variables → Actions → New repository secret**, name `ANTHROPIC_API_KEY`.
4. Enable Pages: repo **Settings → Pages → Source: GitHub Actions**.
5. Generate the first briefing: **Actions tab → Fetch News → Run workflow**.
   Once it finishes (it commits `public/news.json`), the **Deploy** workflow
   fires automatically and publishes the site.
6. Your dashboard link is `https://<username>.github.io/<repo-name>/` — that's
   the one to bookmark / set as a new-tab page.

## Customizing

- Categories, colors, and quick-filter tags live at the top of `src/App.jsx`
  (`CATEGORIES`, `MINERAL_TAGS`).
- The search prompt and JSON schema the model must return live in
  `scripts/fetch-news.mjs` (`PROMPT`) — edit this to shift topic focus.
- To fetch more/less often, edit the `cron` schedule in
  `.github/workflows/fetch-news.yml`.
- To test the fetch script locally: `ANTHROPIC_API_KEY=sk-... npm run fetch-news`.
