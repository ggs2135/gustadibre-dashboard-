// Runs on a schedule via .github/workflows/fetch-news.yml. Pulls recent
// academic papers about critical minerals from OpenAlex (primary) and
// Semantic Scholar (secondary, best-effort) — both free, no API key needed.
// Google Scholar has no public API at all, and the New York Public Library's
// API is a catalog of digitized historical materials, not current journal
// content, so neither is usable here.
import { writeFile } from "node:fs/promises";

const MAX_AGE_DAYS = 182; // ~6 months
const CONTACT_EMAIL = "gustavosigelmann@hotmail.com"; // OpenAlex "polite pool" — faster, more reliable

const TOPICS = [
  "critical minerals",
  "rare earth recycling",
  "lithium battery recycling",
  "critical minerals supply chain",
  "rare earth magnet recovery",
  "hydrometallurgy critical metals",
];

function sinceDate() {
  const d = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function truncate(text, max) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

// OpenAlex abstracts come back as an inverted index ({word: [positions]})
// instead of plain text — this reassembles it into a readable string.
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return "";
  const positions = [];
  for (const [word, idxs] of Object.entries(invertedIndex)) {
    for (const idx of idxs) positions[idx] = word;
  }
  return positions.join(" ");
}

async function fetchOpenAlex(topic, from) {
  // title_and_abstract.search (phrase-quoted) instead of the default `search`
  // param, which matches loosely against full text and pulls in unrelated
  // papers (bakery industry, animal nutrition, etc. all surfaced on generic
  // single-word overlap).
  const filter = `title_and_abstract.search:"${topic}",from_publication_date:${from}`;
  const url = `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}&per-page=8&sort=publication_date:desc&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`OpenAlex "${topic}": HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((w) => ({
      title: w.title || w.display_name || "Untitled",
      authors: (w.authorships || []).slice(0, 4).map((a) => a.author?.display_name).filter(Boolean),
      venue: w.primary_location?.source?.display_name || null,
      date: w.publication_date || null,
      abstract: truncate(reconstructAbstract(w.abstract_inverted_index), 320),
      link: w.primary_location?.landing_page_url || w.doi || w.id,
      source: "OpenAlex",
      _sortDate: w.publication_date ? new Date(w.publication_date).getTime() : 0,
    }));
  } catch (e) {
    console.warn(`OpenAlex "${topic}": ${e.message}`);
    return [];
  }
}

async function fetchSemanticScholar(topic, from) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(topic)}&fields=title,abstract,venue,publicationDate,authors,externalIds&limit=6&publicationDateOrYear=${from}:`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`Semantic Scholar "${topic}": HTTP ${res.status} (likely rate-limited without a key — skipping)`);
      return [];
    }
    const data = await res.json();
    return (data.data || []).map((p) => ({
      title: p.title || "Untitled",
      authors: (p.authors || []).slice(0, 4).map((a) => a.name).filter(Boolean),
      venue: p.venue || null,
      date: p.publicationDate || null,
      abstract: truncate(p.abstract || "", 320),
      link: p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : `https://www.semanticscholar.org/paper/${p.paperId}`,
      source: "Semantic Scholar",
      _sortDate: p.publicationDate ? new Date(p.publicationDate).getTime() : 0,
    }));
  } catch (e) {
    console.warn(`Semantic Scholar "${topic}": ${e.message} — skipping`);
    return [];
  }
}

async function fetchPapers() {
  const from = sinceDate();

  const openAlexResults = await Promise.all(TOPICS.map((t) => fetchOpenAlex(t, from)));
  const semanticResults = await Promise.all(TOPICS.slice(0, 3).map((t) => fetchSemanticScholar(t, from)));

  const all = [...openAlexResults.flat(), ...semanticResults.flat()];

  // Dedupe by normalized title (same paper often surfaces from both sources
  // and from multiple topic queries).
  const byTitle = new Map();
  for (const item of all) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!byTitle.has(key)) byTitle.set(key, item);
  }

  const deduped = [...byTitle.values()];
  deduped.sort((a, b) => b._sortDate - a._sortDate);

  return deduped.slice(0, 24).map(({ _sortDate, ...rest }) => rest);
}

const items = await fetchPapers();

const payload = {
  generatedAt: new Date().toISOString(),
  items,
};

await writeFile(
  new URL("../public/papers.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n",
);

console.log(`Wrote ${items.length} papers to public/papers.json`);
