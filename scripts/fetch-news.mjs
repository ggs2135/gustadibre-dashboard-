// Runs on a schedule via .github/workflows/fetch-news.yml. Pulls headlines
// straight from public RSS feeds (no API key, no paid service) and sorts each
// one into a category / mineral tag by keyword matching. Writes public/news.json,
// which the static frontend just reads.
import { writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_AGE_DAYS = 3;
const PER_CATEGORY_CAP = 4;
const MAX_TOTAL_ITEMS = 10;

const FEEDS = [
  { url: "https://www.mining.com/category/commodities/battery-metals/feed/", source: "MINING.com — Battery Metals" },
  { url: "https://www.mining.com/feed/", source: "MINING.com" },
  { url: "https://im-mining.com/feed/", source: "International Mining" },
  { url: "https://www.northernminer.com/feed/", source: "The Northern Miner" },
  { url: "https://www.canadianminingjournal.com/feed/", source: "Canadian Mining Journal" },
  { url: "https://www.rdworldonline.com/feed/", source: "R&D World", requireKeywordMatch: true },
  { url: "https://phys.org/rss-feed/chemistry-news/", source: "Phys.org Chemistry", requireKeywordMatch: true },
  { url: "https://news.crunchbase.com/feed/", source: "Crunchbase News", requireKeywordMatch: true },
  // NPR's classic developer API was retired in July 2025 — RSS is the only
  // free path left.
  { url: "https://feeds.npr.org/1001/rss.xml", source: "NPR", requireKeywordMatch: true },
  { url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", source: "WSJ — Markets", requireKeywordMatch: true },
  { url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", source: "WSJ — World News", requireKeywordMatch: true },
  // G1 has no public API; section RSS feeds are the free path.
  { url: "https://g1.globo.com/rss/g1/economia/", source: "G1 — Economia", requireKeywordMatch: true },
  { url: "https://g1.globo.com/rss/g1/ciencia-e-saude", source: "G1 — Ciência e Saúde", requireKeywordMatch: true },
];

// category -> keywords checked against "title. summary"
const CATEGORY_RULES = [
  ["politics", [
    "department of state", "state department", "white house", "congress", "senate",
    "executive order", "sanctions", "geopolit", "national security", "export control",
    "export ban", "trade war", "trade deal", "bilateral agreement", "diplomat",
    "ministry of mines", "government announces", "biden", "trump administration",
    "foreign policy", "defense production act",
  ]],
  ["instrumentation", [
    "icp-ms", "icp-oes", "icp ms", "icp oes", "xrf", "spectrometer", "spectroscopy",
    "mass spec", "assay method", "analyzer", "analytical instrument", "laboratory equipment",
    "thermo fisher", "agilent", "perkinelmer", "bruker", "lab tech",
  ]],
  ["funding", [
    "grant", "funding round", "raises $", "raised $", "series a", "series b", "series c",
    "venture capital", "vc firm", "investment round", "invests $", "ipo", "financing deal",
    "million in funding", "backed by", "seed round", "capital raise", "startup",
  ]],
  ["science", [
    "recycl", "recovery process", "hydrometallurg", "leaching", "extraction method",
    "breakthrough", "novel process", "researchers develop", "study finds", "pilot plant",
    "bioleaching",
  ]],
  ["economic", [
    "spot price", "futures", "commodity price", "trading at", "market outlook",
    "price surge", "price slump", "tariff", "shares rose", "shares fell", "valuation",
  ]],
  // "supply" has no keyword list — it's the default fallback for mining/policy/project stories.
];

const MINERAL_TAGS = [
  "Rare earths", "Lithium", "Cobalt", "Nickel", "Copper",
  "Graphite", "Gallium", "Germanium", "Recycling", "Tailings",
  "ICP-MS", "ICP-OES", "XRF", "Assay methods", "Grants", "Venture capital",
  "Silver", "Rhodium", "Palladium", "Platinum", "Brazil",
];

// Applied to feeds that aren't mining-specific (general news/chemistry/R&D/
// startup outlets) so unrelated stories don't dilute the briefing. Mixed
// English/Portuguese since G1 publishes in Portuguese.
const BROAD_FEED_KEYWORDS = [
  "mining", "mineral", "lithium", "cobalt", "nickel", "rare earth", "battery metal",
  "critical mineral", "graphite", "recycling", "icp-ms", "icp-oes", "xrf",
  "geochemistry", "ore", "smelter", "tailings", "assay", "gallium", "germanium",
  "silver", "rhodium", "palladium", "platinum",
  "minerais críticos", "terras raras", "lítio", "cobalto", "níquel", "grafite",
  "minério", "mineração",
];

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;|&lsquo;/g, "’")
    .replace(/&ldquo;|&rdquo;/g, "”")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&") // must run after numeric entities to avoid double-decoding "&amp;#39;"
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(html) {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\[\s*…\s*\]\s*$/, "")
    .replace(/\s*The post .* appeared first on .*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// Boundary only at the start of the match — plain .includes() would let "ore"
// match inside "more"; a boundary at both ends would then miss "tariff" inside
// "tariffs". Word-start anchoring avoids the false positive while still
// matching plurals/suffixes ("recycling", "tariffs", "financings").
function hasKeyword(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`, "i").test(text);
}

function categorize(text) {
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((k) => hasKeyword(text, k))) return category;
  }
  return "supply";
}

function matchTags(text) {
  return MINERAL_TAGS.filter((tag) => hasKeyword(text, tag)).slice(0, 5);
}

async function fetchFeed({ url, source, requireKeywordMatch }) {
  let xml;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`Skipping ${source}: HTTP ${res.status}`);
      return [];
    }
    xml = await res.text();
  } catch (e) {
    console.warn(`Skipping ${source}: ${e.message}`);
    return [];
  }

  const parser = new XMLParser({ ignoreAttributes: true, cdataPropName: false });
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (e) {
    console.warn(`Skipping ${source}: unparseable XML (${e.message})`);
    return [];
  }

  const rawItems = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems].filter(Boolean);

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const out = [];

  for (const raw of items) {
    const title = stripHtml(String(raw.title ?? ""));
    const link = typeof raw.link === "string" ? raw.link : raw.link?.["#text"] ?? raw.link?.href ?? "";
    const pubDateRaw = raw.pubDate ?? raw.published ?? raw.updated;
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
    if (!title || !link) continue;
    if (pubDate && !isNaN(pubDate) && pubDate.getTime() < cutoff) continue;

    const rawSummary = raw["content:encoded"] ?? raw.description ?? raw.summary ?? "";
    const summary = truncate(stripHtml(String(rawSummary)), 220) || title;
    const combined = `${title}. ${summary}`;

    if (requireKeywordMatch && !BROAD_FEED_KEYWORDS.some((k) => hasKeyword(combined, k))) {
      continue;
    }

    out.push({
      headline: title,
      summary,
      category: categorize(combined),
      minerals: matchTags(combined),
      source,
      date: pubDate && !isNaN(pubDate) ? pubDate.toISOString().slice(0, 10) : "recent",
      link,
      _sortDate: pubDate && !isNaN(pubDate) ? pubDate.getTime() : 0,
    });
  }

  return out;
}

const NYT_QUERIES = [
  '"critical minerals"',
  '"rare earth"',
];

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchNYT(query, apiKey, cutoff) {
  const begin = ymd(new Date(cutoff));
  const url = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query)}&begin_date=${begin}&sort=newest&api-key=${apiKey}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const detail = res.status === 429 ? " (rate limit/quota exceeded)" : "";
      console.warn(`Skipping NYT "${query}": HTTP ${res.status}${detail}`);
      return [];
    }
    const data = await res.json();
    const docs = data?.response?.docs || [];
    return docs.map((doc) => {
      const pubDate = doc.pub_date ? new Date(doc.pub_date) : null;
      const title = stripHtml(doc.headline?.main || "");
      const summary = truncate(stripHtml(doc.abstract || doc.snippet || ""), 220) || title;
      const combined = `${title}. ${summary}`;
      if (!title || !doc.web_url) return null;
      return {
        headline: title,
        summary,
        category: categorize(combined),
        minerals: matchTags(combined),
        source: "The New York Times",
        date: pubDate && !isNaN(pubDate) ? pubDate.toISOString().slice(0, 10) : "recent",
        link: doc.web_url,
        _sortDate: pubDate && !isNaN(pubDate) ? pubDate.getTime() : 0,
      };
    }).filter(Boolean);
  } catch (e) {
    console.warn(`Skipping NYT "${query}": ${e.message}`);
    return [];
  }
}

async function fetchAllNYT(cutoff) {
  const apiKey = process.env.NYT_API_KEY;
  if (!apiKey) {
    console.warn("NYT_API_KEY not set — skipping NYT Article Search");
    return [];
  }
  // NYT rate-limits to a handful of requests/sec — run sequentially with a
  // small gap between calls.
  const out = [];
  for (const q of NYT_QUERIES) {
    out.push(...await fetchNYT(q, apiKey, cutoff));
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

async function fetchNews() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const nyt = await fetchAllNYT(cutoff);
  const all = [...results.flat(), ...nyt];

  // Dedupe by link, keep the most recent per link.
  const byLink = new Map();
  for (const item of all) {
    const existing = byLink.get(item.link);
    if (!existing || item._sortDate > existing._sortDate) byLink.set(item.link, item);
  }
  const deduped = [...byLink.values()];

  // Spread across categories instead of letting the biggest feed dominate.
  const byCategory = new Map();
  for (const item of deduped) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  const picked = [];
  for (const [, group] of byCategory) {
    group.sort((a, b) => b._sortDate - a._sortDate);
    picked.push(...group.slice(0, PER_CATEGORY_CAP));
  }

  picked.sort((a, b) => b._sortDate - a._sortDate);
  return picked.slice(0, MAX_TOTAL_ITEMS).map(({ _sortDate, ...rest }) => rest);
}

const items = await fetchNews();
if (!items.length) {
  throw new Error("No items found across any feed — check feed URLs / network access.");
}

const payload = {
  generatedAt: new Date().toISOString(),
  items,
};

await writeFile(
  new URL("../public/news.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n",
);

console.log(`Wrote ${items.length} items to public/news.json`);
