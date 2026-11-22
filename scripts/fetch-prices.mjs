// Runs daily via .github/workflows/update-and-deploy.yml. Writes
// public/prices.json with, per metal: latest close, a ~3-month daily history,
// and precomputed 1D / 1W / 1M changes.
//
// Sources:
//  - Yahoo Finance chart API (no key): COMEX/NYMEX front-month futures for
//    exchange-traded metals. Returns ~3 months of daily closes per call, so
//    deltas work from the very first run.
//  - Johnson Matthey base prices (no key): rhodium, which has no futures
//    contract. JM's PGM page embeds the last ~5 business days as JSON; older
//    days are kept by carrying forward the previous prices.json between runs,
//    so 1W/1M fill in after the script has been running a week / a month.
//
// Minor metals (Ge, Ga, In, …) are not exchange-traded — they're assessed by
// Fastmarkets / Argus / SMM behind paid feeds — so they're not included.
import { readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../public/prices.json", import.meta.url);
const HISTORY_KEEP = 100; // trading days kept per metal

// unit: the market's native quote unit. toKg converts native price → USD/kg.
const UNITS = {
  ozt: { label: "oz t", toKg: 1000 / 31.1034768 },
  lb: { label: "lb", toKg: 1 / 0.45359237 },
  t: { label: "t", toKg: 1 / 1000 },
};

const METALS = [
  { el: "Ag", name: "Silver", z: 47, molarMass: 107.8682, unit: "ozt", source: "yahoo", ticker: "SI=F", venue: "COMEX" },
  { el: "Au", name: "Gold", z: 79, molarMass: 196.96657, unit: "ozt", source: "yahoo", ticker: "GC=F", venue: "COMEX" },
  { el: "Pt", name: "Platinum", z: 78, molarMass: 195.084, unit: "ozt", source: "yahoo", ticker: "PL=F", venue: "NYMEX" },
  { el: "Pd", name: "Palladium", z: 46, molarMass: 106.42, unit: "ozt", source: "yahoo", ticker: "PA=F", venue: "NYMEX" },
  { el: "Rh", name: "Rhodium", z: 45, molarMass: 102.9055, unit: "ozt", source: "jm", ticker: "Rh", venue: "JM base" },
  { el: "Al", name: "Aluminium", z: 13, molarMass: 26.9815385, unit: "t", source: "yahoo", ticker: "ALI=F", venue: "COMEX" },
];

const round = (v, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;
const isoDate = (d) => d.toISOString().slice(0, 10);

async function fetchYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; chemfinities-daily/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const byDate = new Map();
  ts.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) byDate.set(isoDate(new Date(t * 1000)), c);
  });
  return [...byDate].map(([date, close]) => ({ date, close: round(close) }));
}

const JM_URL = "https://matthey.com/products-and-markets/pgms-and-circularity/pgm-management";
let jmCache = null;

// Returns [{date, close}] for one metal code from JM's embedded price JSON.
async function fetchJM(code) {
  if (!jmCache) {
    const res = await fetch(JM_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page = await res.text();
    const unescape = (x) => x.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    jmCache = [];
    for (const m of page.matchAll(/value="(\{[^"]*currentMetalList[^"]*\})"/g)) {
      try { jmCache.push(...(JSON.parse(unescape(m[1])).currentMetalList || [])); } catch { /* skip */ }
    }
    if (!jmCache.length) throw new Error("price JSON not found — page layout may have changed");
  }
  const byDate = new Map();
  for (const r of jmCache) {
    if (r.metalCode !== code) continue;
    const [dd, mm, yyyy] = String(r.metalValueDate).split("/");
    const close = Number(String(r.price).replace(/,/g, ""));
    if (yyyy && Number.isFinite(close)) byDate.set(`${yyyy}-${mm}-${dd}`, close);
  }
  return [...byDate].map(([date, close]) => ({ date, close })).sort((x, y) => x.date.localeCompare(y.date));
}

// Last point on or before `target` (YYYY-MM-DD).
function pointOnOrBefore(history, target) {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].date <= target) return history[i];
  return null;
}

function change(latest, ref) {
  if (!ref || !ref.close) return null;
  return { ref: ref.close, refDate: ref.date, abs: round(latest.close - ref.close), pct: round(((latest.close - ref.close) / ref.close) * 100, 3) };
}

function computeChanges(history) {
  const latest = history.at(-1);
  if (!latest) return {};
  const d = new Date(`${latest.date}T00:00:00Z`);
  const weekAgo = new Date(d); weekAgo.setUTCDate(d.getUTCDate() - 7);
  const monthAgo = new Date(d); monthAgo.setUTCMonth(d.getUTCMonth() - 1);
  const w = pointOnOrBefore(history, isoDate(weekAgo));
  const m = pointOnOrBefore(history, isoDate(monthAgo));
  return {
    d1: change(latest, history.at(-2)),
    w1: w && w.date !== latest.date ? change(latest, w) : null,
    m1: m && m.date !== latest.date ? change(latest, m) : null,
  };
}

async function readPrevious() {
  try {
    const prev = JSON.parse(await readFile(OUT, "utf8"));
    return Object.fromEntries((prev.metals || []).filter((m) => m.el).map((m) => [m.el, m]));
  } catch {
    return {};
  }
}

const previous = await readPrevious();

const metals = [];
for (const m of METALS) {
  let history = [];
  try {
    if (m.source === "yahoo") {
      history = await fetchYahoo(m.ticker);
    } else {
      // Merge JM's recent days over our carried-forward history (JM wins on overlap).
      const merged = new Map((previous[m.el]?.history || []).map((p) => [p.date, p.close]));
      for (const p of await fetchJM(m.ticker)) merged.set(p.date, p.close);
      history = [...merged].map(([date, close]) => ({ date, close })).sort((x, y) => x.date.localeCompare(y.date));
    }
  } catch (e) {
    console.warn(`${m.name} (${m.ticker}): ${e.message}`);
    history = previous[m.el]?.history || []; // keep last good data rather than dropping the row
  }

  history = history.slice(-HISTORY_KEEP);
  if (!history.length) {
    console.warn(`No data for ${m.name} — omitting`);
    continue;
  }

  const latest = history.at(-1);
  metals.push({
    el: m.el,
    name: m.name,
    z: m.z,
    molarMass: m.molarMass,
    unit: UNITS[m.unit].label,
    toKg: UNITS[m.unit].toKg,
    venue: m.venue,
    ticker: m.ticker,
    sourceLabel: m.source === "yahoo" ? `${m.venue} · ${m.ticker.replace("=F", "")}` : "Johnson Matthey base",
    price: latest.close,
    asOf: latest.date,
    changes: computeChanges(history),
    history,
  });
}

await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), metals }, null, 2) + "\n");
console.log(`Wrote ${metals.length} metal prices to public/prices.json`);
