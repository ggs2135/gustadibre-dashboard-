// Runs on a schedule via .github/workflows/fetch-news.yml. Pulls headlines
// straight from public RSS feeds (no API key, no paid service) and sorts each
// one into a category / mineral tag by keyword matching. Writes public/news.json,
// which the static frontend just reads.
import { writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_AGE_DAYS = 5;
const PER_CATEGORY_CAP = 4;

const FEEDS = [
  { url: "https://www.mining.com/category/commodities/battery-metals/feed/", source: "MINING.com — Battery Metals" },
  { url: "https://www.mining.com/feed/", source: "MINING.com" },
  { url: "https://im-mining.com/feed/", source: "International Mining" },
  { url: "https://www.northernminer.com/feed/", source: "The Northern Miner" },
  { url: "https://www.canadianminingjournal.com/feed/", source: "Canadian Mining Journal" },
  { url: "https://www.rdworldonline.com/feed/", source: "R&D World", requireKeywordMatch: true },
  { url: "https://phys.org/rss-feed/chemistry-news/", source: "Phys.org Chemistry", requireKeywordMatch: true },
  { url: "https://news.crunchbase.com/feed/", source: "Crunchbase News", requireKeywordMatch: true },
];

// category -> keywords checked against "title. summary"
const CATEGORY_RULES = [
  ["instrumentation", [
    "icp-ms", "icp-oes", "icp ms", "icp oes", "xrf", "spectrometer", "spectroscopy",
    "mass spec", "assay method", "analyzer", "analytical instrument", "laboratory equipment",
    "thermo fisher", "agilent", "perkinelmer", "bruker", "lab tech",
  ]],
  ["funding", [
    "grant", "funding round", "raises $", "raised $", "series a", "series b", "series c",
    "venture capital", "vc firm", "investment round", "invests $", "ipo", "financing deal",
    "million in funding", "backed by", "seed round", "capital raise",
  ]],
  ["science", [
    "recycl", "recovery process", "hydrometallurg", "leaching", "extraction method",
    "breakthrough", "novel process", "researchers develop", "study finds", "pilot plant",
    "bioleaching",
  ]],
  ["economic", [
    "spot price", "futures", "commodity price", "trading at", "market outlook",
    "price surge", "price slump", "tariff", "export ban", "trade deal", "shares rose", "shares fell",
  ]],
  // "supply" has no keyword list — it's the default fallback for mining/policy/project stories.
];

const MINERAL_TAGS = [
  "Rare earths", "Lithium", "Cobalt", "Nickel", "Copper",
  "Graphite", "Gallium", "Germanium", "Recycling", "Tailings",
  "ICP-MS", "ICP-OES", "XRF", "Assay methods", "Grants", "Venture capital",
];

// Applied to feeds that aren't mining-specific (general chemistry/R&D/startup
// news outlets) so unrelated stories don't dilute the briefing.
const BROAD_FEED_KEYWORDS = [
  "mining", "mineral", "lithium", "cobalt", "nickel", "rare earth", "battery metal",
  "critical mineral", "graphite", "recycling", "icp-ms", "icp-oes", "icp-ms", "xrf",
  "geochemistry", "ore", "smelter", "tailings", "assay", "gallium", "germanium",
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

async function fetchNews() {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const all = results.flat();

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
  return picked.map(({ _sortDate, ...rest }) => rest);
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
