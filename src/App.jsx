import React, { useState, useEffect, useCallback, useMemo } from "react";

// ── Design tokens ─────────────────────────────────────────────
// Minimal, calm palette. One accent (turtle teal) carries the brand;
// category colors are softened variants of the same family so nothing shouts.
const DARK = {
  bg: "#10161A",
  panel: "#161E22",
  panelEdge: "#212B30",
  ink: "#EDF1F2",
  dim: "#95A3A8",
  faint: "#5C6B70",
  accent: "#3FA796",
  line: "#232E33",
};

const LIGHT = {
  bg: "#FAFAF7",
  panel: "#FFFFFF",
  panelEdge: "#E7E4DD",
  ink: "#1B2426",
  dim: "#5B6A6E",
  faint: "#8B979A",
  accent: "#1F8577",
  line: "#E4E1D9",
};

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "supply", label: "Critical Minerals & Supply", color: "#E0A458" },
  { id: "politics", label: "Politics & Policy", color: "#5B8DBF" },
  { id: "funding", label: "Funding & Investment", color: "#8C7AE6" },
  { id: "instrumentation", label: "Instrumentation & Lab Tech" }, // falls back to accent
  { id: "economic", label: "Markets & Economics", color: "#D97757" },
  { id: "science", label: "Science & Recovery", color: "#6FBF73" },
];

const MINERAL_TAGS = [
  "Rare earths", "Lithium", "Cobalt", "Nickel", "Copper",
  "Graphite", "Gallium", "Germanium", "Recycling", "Tailings",
  "ICP-MS", "ICP-OES", "XRF", "Assay methods", "Grants", "Venture capital",
  "Silver", "Rhodium", "Palladium", "Platinum", "Brazil",
];

// All four files below are generated on a schedule (see scripts/fetch-*.mjs
// and .github/workflows/fetch-news.yml) and committed as static files. The
// frontend only ever reads these — no API keys are ever exposed to the browser.
const NEWS_URL = "./news.json";
const PODCASTS_URL = "./podcasts.json";
const PAPERS_URL = "./papers.json";
const PRICES_URL = "./prices.json";

// Mirrors MAX_AGE_DAYS in scripts/fetch-news.mjs / fetch-papers.mjs — these
// aren't read from the JSON files, just kept in sync by hand.
const MAX_NEWS_AGE_DAYS = 3;
const MAX_PAPERS_AGE_MONTHS = 6;

// Default carousel sizes before "See more" expands a section into a full list.
const NEWS_CAROUSEL_LIMIT = 10;
const PAPERS_CAROUSEL_LIMIT = 5;
const PODCASTS_CAROUSEL_LIMIT = 5;

const THEME_KEY = "gd-theme";

function formatShortDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function TurtleIcon({ size = 32, color, bg }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="30" cy="14" rx="10" ry="7" fill={color} />
      <ellipse cx="30" cy="58" rx="10" ry="7" fill={color} />
      <ellipse cx="80" cy="16" rx="9" ry="6" fill={color} />
      <ellipse cx="80" cy="56" rx="9" ry="6" fill={color} />
      <path d="M96 36 L86 30 L86 42 Z" fill={color} />
      <circle cx="14" cy="36" r="12" fill={color} />
      <ellipse cx="58" cy="36" rx="34" ry="24" fill={color} />
      <path d="M58 16 A24 20 0 0 0 58 56" stroke={bg} strokeWidth="2.5" fill="none" opacity="0.35" />
      <path d="M40 20 L52 30 M76 20 L64 30 M40 52 L52 42 M76 52 L64 42" stroke={bg} strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
    </svg>
  );
}

function SunIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
    </svg>
  );
}

function MoonIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* localStorage unavailable */ }
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* localStorage unavailable */ }
  }, [theme]);

  return [theme, setTheme];
}

export default function GustaDibreDashboard() {
  const [theme, setTheme] = useTheme();
  const C = useMemo(() => (theme === "light" ? LIGHT : DARK), [theme]);

  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState("all");
  const [tag, setTag] = useState(null);

  const [shows, setShows] = useState([]);
  const [papers, setPapers] = useState([]);
  const [papersGeneratedAt, setPapersGeneratedAt] = useState(null);
  const [metals, setMetals] = useState([]);

  const [newsExpanded, setNewsExpanded] = useState(false);
  const [papersExpanded, setPapersExpanded] = useState(false);
  const [podcastsExpanded, setPodcastsExpanded] = useState(false);

  // Podcasts/papers/prices are nice-to-haves — fail silently (just don't
  // render the section) rather than showing an error banner like the main
  // briefing does.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${PODCASTS_URL}?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        setShows(Array.isArray(data.shows) ? data.shows : []);
      } catch { /* section just won't render */ }
    })();
    (async () => {
      try {
        const res = await fetch(`${PAPERS_URL}?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        setPapers(Array.isArray(data.items) ? data.items : []);
        setPapersGeneratedAt(data.generatedAt || null);
      } catch { /* section just won't render */ }
    })();
    (async () => {
      try {
        const res = await fetch(`${PRICES_URL}?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        setMetals(Array.isArray(data.metals) ? data.metals : []);
      } catch { /* section just won't render */ }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${NEWS_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parsedItems = Array.isArray(data.items) ? data.items : [];
      if (!parsedItems.length) {
        setError("The last briefing came back empty. The next scheduled run should fix this.");
      }
      setItems(parsedItems);
      setGeneratedAt(data.generatedAt || null);
    } catch (e) {
      setError("Couldn't load the briefing file. It may not have been generated yet — check the 'Fetch News' GitHub Action.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((it) => {
    const catOk = active === "all" || it.category === active;
    const tagOk = !tag || (it.minerals || []).some(
      (m) => m.toLowerCase().includes(tag.toLowerCase())
    );
    return catOk && tagOk;
  });

  const catMeta = (id) => CATEGORIES.find((c) => c.id === id) || {};

  return (
    <div style={{
      background: C.bg, color: C.ink, minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    }}>
      <style>{`
        * { box-sizing: border-box; }
        .cm-mono { font-family: 'SF Mono','Menlo','Consolas',monospace; }
        html { -webkit-text-size-adjust: 100%; }
        .cm-card { transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease; }
        .cm-card h2, .cm-card p { overflow-wrap: anywhere; }
        .cm-btn { cursor:pointer; transition: all .15s ease; -webkit-tap-highlight-color: transparent; }
        .cm-btn:active { background:${C.accent}; color:${C.bg}; border-color:${C.accent}; }
        @media (hover:hover) {
          .cm-card:hover { border-color:${C.accent}; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.18); }
          .cm-btn:hover { background:${C.accent}; color:${C.bg}; border-color:${C.accent}; }
        }
        .cm-select { flex: 1 1 200px; min-width: 0; max-width: 100%; }
        .cm-section-label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.dim}; }
        .cm-carousel { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x proximity; padding-bottom: 6px; margin: 0 -2px; }
        .cm-carousel::-webkit-scrollbar { height: 6px; }
        .cm-carousel::-webkit-scrollbar-thumb { background: ${C.panelEdge}; border-radius: 3px; }
        .cm-pod-card { scroll-snap-align: start; flex: 0 0 200px; }
        .cm-tile-card { scroll-snap-align: start; flex: 0 0 230px; }
        .cm-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .cm-stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
        .cm-seemore { background: transparent; border: none; color: ${C.accent}; font-size: 11px; letter-spacing: 0.04em; padding: 10px 2px 0; display: block; text-align: right; width: 100%; }
        @media (max-width:640px){
          .cm-pod-card{flex-basis:168px !important;}
          .cm-tile-card{flex-basis:200px !important;}
        }
        @keyframes pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
        .cm-pulse { animation: pulse 1.3s ease-in-out infinite; }
        :focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px; }
        @media (max-width:640px){
          .cm-wrap{padding:20px max(16px, env(safe-area-inset-right)) calc(48px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) !important;}
          .cm-title{font-size:22px !important;}
          .cm-icon-btn{width:40px !important; height:40px !important;}
          .cm-refresh{padding:0 14px !important; height:40px; display:flex; align-items:center;}
          .cm-select{flex-basis:100%; font-size:16px !important; padding:10px 12px !important;}
          .cm-card{padding:16px !important;}
          .cm-card h2{font-size:17px !important;}
          .cm-card p{font-size:15px !important;}
          .cm-meta{flex-direction:column; align-items:flex-start !important; gap:4px !important;}
          .cm-actions{flex-direction:column; align-items:stretch !important; gap:12px !important;}
          .cm-read{text-align:center; padding:10px 12px !important; font-size:12px !important;}
        }
      `}</style>

      <div className="cm-wrap" style={{ maxWidth: 780, margin: "0 auto", padding: "48px 28px 80px" }}>

        {/* Masthead */}
        <header style={{ borderBottom: `1px solid ${C.line}`, paddingBottom: 24, marginBottom: 8 }}>
          <div style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "center", flexWrap: "wrap", gap: 16,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <TurtleIcon size={40} color={C.accent} bg={C.bg} />
              <div>
                <h1 className="cm-title" style={{
                  margin: 0, fontSize: 28, fontWeight: 700, lineHeight: 1.15,
                  letterSpacing: "-0.01em",
                }}>
                  Gusta-dibre
                </h1>
                <div style={{ color: C.dim, fontSize: 14, marginTop: 2 }}>
                  Critical Mineral Dashboard
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className="cm-btn cm-icon-btn"
                aria-label={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
                title={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
                style={{
                  background: "transparent", color: C.dim,
                  border: `1px solid ${C.line}`, borderRadius: 6,
                  width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              </button>
              <button
                onClick={load}
                className="cm-btn cm-mono cm-refresh"
                style={{
                  background: "transparent", color: C.dim,
                  border: `1px solid ${C.line}`, borderRadius: 6,
                  padding: "8px 14px", fontSize: 11, letterSpacing: "0.08em",
                  textTransform: "uppercase", whiteSpace: "nowrap",
                }}
              >
                ↻ Refresh
              </button>
            </div>
          </div>
          <div className="cm-mono" style={{ color: C.faint, fontSize: 12, marginTop: 16 }}>
            {generatedAt ? `Updated ${formatGeneratedAt(generatedAt)}` : "Awaiting first briefing"} · assembled daily
          </div>
        </header>

        {/* Metal prices */}
        {metals.length > 0 && (
          <div style={{ margin: "0 0 28px" }}>
            <div className="cm-section-label" style={{ marginBottom: 12 }}>Spot Prices (USD / troy oz)</div>
            <div className="cm-stat-row">
              {metals.map((m) => (
                <div key={m.symbol} style={{
                  background: C.panel, border: `1px solid ${C.panelEdge}`,
                  borderRadius: 10, padding: "12px 14px",
                }}>
                  <div className="cm-mono" style={{ fontSize: 10.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {m.name}
                  </div>
                  <div className="cm-mono" style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 4 }}>
                    ${m.usdPerOz.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* News */}
        <div className="cm-section-label" style={{
          marginTop: metals.length > 0 ? 8 : 28,
        }}>
          News <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>· last {MAX_NEWS_AGE_DAYS} days</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 28px" }}>
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            className="cm-mono cm-select"
            style={{
              background: C.panel, color: active !== "all" ? C.ink : C.faint,
              border: `1px solid ${active !== "all" ? C.accent : C.line}`,
              borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
              letterSpacing: "0.02em", cursor: "pointer",
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.id === "all" ? "All categories" : c.label}</option>
            ))}
          </select>

          <select
            value={tag || ""}
            onChange={(e) => setTag(e.target.value || null)}
            className="cm-mono cm-select"
            style={{
              background: C.panel, color: tag ? C.ink : C.faint,
              border: `1px solid ${tag ? C.accent : C.line}`,
              borderRadius: 8, padding: "8px 12px", fontSize: 12.5,
              letterSpacing: "0.02em", cursor: "pointer",
            }}
          >
            <option value="">All minerals & topics</option>
            {MINERAL_TAGS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Body */}
        {loading && (
          <div className="cm-mono" style={{ color: C.dim, fontSize: 13, padding: "40px 0" }}>
            <span className="cm-pulse">Loading today's briefing…</span>
          </div>
        )}

        {error && !loading && (
          <div style={{
            border: `1px solid ${C.line}`, borderRadius: 8,
            padding: 20, color: C.dim,
          }}>
            {error}
            <button onClick={load} className="cm-btn cm-mono" style={{
              display: "block", marginTop: 12, background: "transparent",
              color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6,
              padding: "6px 12px", fontSize: 11,
            }}>Retry</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="cm-mono" style={{ color: C.dim, fontSize: 13, padding: "30px 0" }}>
            No stories match this filter today.
          </div>
        )}

        {!loading && !error && filtered.length > 0 && !newsExpanded && (
          <div className="cm-carousel">
            {filtered.slice(0, NEWS_CAROUSEL_LIMIT).map((it, i) => {
              const cm = catMeta(it.category);
              return (
                <a key={i} href={it.link} target="_blank" rel="noopener noreferrer"
                  className="cm-card cm-tile-card" style={{
                    background: C.panel, border: `1px solid ${C.panelEdge}`,
                    borderRadius: 10, padding: 14, textDecoration: "none", color: C.ink,
                    display: "flex", flexDirection: "column", gap: 8,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: cm.color || C.accent, flexShrink: 0 }} />
                    <span className="cm-mono" style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {cm.label || it.category}
                    </span>
                  </span>
                  <div className="cm-clamp-3" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>
                    {it.headline}
                  </div>
                  <div className="cm-mono" style={{ fontSize: 10, color: C.faint, marginTop: "auto" }}>
                    {it.source}{it.date ? ` · ${it.date}` : ""}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && newsExpanded && filtered.map((it, i) => {
          const cm = catMeta(it.category);
          return (
            <article key={i} className="cm-card" style={{
              background: C.panel, border: `1px solid ${C.panelEdge}`,
              borderRadius: 10, padding: "20px 22px", marginBottom: 12,
            }}>
              <div className="cm-meta" style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 10, gap: 10,
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: cm.color || C.accent, display: "inline-block" }} />
                  <span className="cm-mono" style={{
                    color: C.dim, fontSize: 10.5,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                  }}>
                    {cm.label || it.category}
                  </span>
                </span>
                <span className="cm-mono" style={{ color: C.faint, fontSize: 10.5 }}>
                  {it.source}{it.date ? ` · ${it.date}` : ""}
                </span>
              </div>

              <h2 style={{
                margin: "0 0 8px", fontSize: 18, fontWeight: 600,
                lineHeight: 1.3,
              }}>
                {it.headline}
              </h2>

              <p style={{
                margin: "0 0 14px", color: C.dim, fontSize: 14.5,
                lineHeight: 1.55,
              }}>
                {it.summary}
              </p>

              <div className="cm-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {(it.minerals || []).length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {it.minerals.slice(0, 5).map((m, k) => (
                    <span key={k} className="cm-mono" style={{
                      color: C.faint, fontSize: 10, background: C.panelEdge,
                      borderRadius: 10, padding: "2px 8px",
                    }}>
                      {m}
                    </span>
                  ))}
                </div>}
                {it.link && (
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cm-btn cm-mono cm-read"
                    style={{
                      background: "transparent", color: C.accent,
                      border: `1px solid ${C.line}`, borderRadius: 6,
                      padding: "5px 11px", fontSize: 10.5, letterSpacing: "0.04em",
                      whiteSpace: "nowrap", textDecoration: "none",
                    }}
                  >
                    Read full story →
                  </a>
                )}
              </div>
            </article>
          );
        })}

        {!loading && !error && filtered.length > 0 && (
          <button onClick={() => setNewsExpanded((e) => !e)} className="cm-btn cm-mono cm-seemore">
            {newsExpanded ? "Show compact view ↑" : `See all ${filtered.length} →`}
          </button>
        )}

        {/* Papers */}
        {papers.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div className="cm-section-label" style={{ marginBottom: 12, paddingTop: 24, borderTop: `1px solid ${C.line}` }}>
              Recent Papers <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0 }}>· last {MAX_PAPERS_AGE_MONTHS} months</span>
            </div>

            {!papersExpanded && (
              <div className="cm-carousel">
                {papers.slice(0, PAPERS_CAROUSEL_LIMIT).map((p, i) => (
                  <a key={i} href={p.link} target="_blank" rel="noopener noreferrer"
                    className="cm-card cm-tile-card" style={{
                      background: C.panel, border: `1px solid ${C.panelEdge}`,
                      borderRadius: 10, padding: 14, textDecoration: "none", color: C.ink,
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    <span className="cm-mono" style={{ fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {p.venue || p.source}
                    </span>
                    <div className="cm-clamp-3" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>
                      {p.title}
                    </div>
                    <div className="cm-mono" style={{ fontSize: 10, color: C.faint, marginTop: "auto" }}>
                      {p.date || ""}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {papersExpanded && papers.map((p, i) => (
              <article key={i} className="cm-card" style={{
                background: C.panel, border: `1px solid ${C.panelEdge}`,
                borderRadius: 10, padding: "18px 22px", marginBottom: 12,
              }}>
                <div className="cm-meta" style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8, gap: 10,
                }}>
                  <span className="cm-mono" style={{ color: C.dim, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {p.venue || p.source}
                  </span>
                  <span className="cm-mono" style={{ color: C.faint, fontSize: 10.5 }}>
                    {p.date || ""}
                  </span>
                </div>
                <h2 style={{ margin: "0 0 6px", fontSize: 16.5, fontWeight: 600, lineHeight: 1.3 }}>
                  {p.title}
                </h2>
                {p.authors?.length > 0 && (
                  <div className="cm-mono" style={{ color: C.faint, fontSize: 11.5, marginBottom: 8 }}>
                    {p.authors.join(", ")}
                  </div>
                )}
                {p.abstract && (
                  <p style={{ margin: "0 0 12px", color: C.dim, fontSize: 13.5, lineHeight: 1.55 }}>
                    {p.abstract}
                  </p>
                )}
                {p.link && (
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cm-btn cm-mono cm-read"
                    style={{
                      background: "transparent", color: C.accent,
                      border: `1px solid ${C.line}`, borderRadius: 6,
                      padding: "5px 11px", fontSize: 10.5, letterSpacing: "0.04em",
                      whiteSpace: "nowrap", textDecoration: "none", display: "inline-block",
                    }}
                  >
                    Read paper →
                  </a>
                )}
              </article>
            ))}

            <button onClick={() => setPapersExpanded((e) => !e)} className="cm-btn cm-mono cm-seemore">
              {papersExpanded ? "Show compact view ↑" : `See all ${papers.length} →`}
            </button>
          </div>
        )}

        {/* Podcasts */}
        {shows.length > 0 && (
          <div style={{ marginTop: 36 }}>
            <div className="cm-section-label" style={{ marginBottom: 12, paddingTop: 24, borderTop: `1px solid ${C.line}` }}>Podcasts</div>

            {!podcastsExpanded && (
              <div className="cm-carousel">
                {shows.slice(0, PODCASTS_CAROUSEL_LIMIT).map((s, i) => (
                  <a
                    key={i}
                    href={s.latestEpisode?.url || s.showUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cm-card cm-pod-card"
                    style={{
                      background: C.panel, border: `1px solid ${C.panelEdge}`,
                      borderRadius: 10, padding: 14, textDecoration: "none", color: C.ink,
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {s.coverArt ? (
                        <img src={s.coverArt} alt="" width={40} height={40}
                          style={{ borderRadius: 6, flexShrink: 0, objectFit: "cover" }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                          background: C.panelEdge,
                        }} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div className="cm-mono" style={{
                          fontSize: 10.5, color: C.faint, textTransform: "uppercase",
                          letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {s.name}
                        </div>
                        {s.latestEpisode?.isNew && (
                          <span className="cm-mono" style={{
                            fontSize: 9, color: C.accent, letterSpacing: "0.06em",
                          }}>
                            ● NEW
                          </span>
                        )}
                      </div>
                    </div>
                    {s.latestEpisode ? (
                      <>
                        <div className="cm-clamp-3" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                          {s.latestEpisode.title}
                        </div>
                        <div className="cm-mono" style={{ fontSize: 10.5, color: C.faint, marginTop: "auto" }}>
                          {formatShortDate(s.latestEpisode.date)} · Spotify →
                        </div>
                      </>
                    ) : (
                      <div className="cm-mono" style={{ fontSize: 11, color: C.faint }}>
                        Open on Spotify →
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}

            {podcastsExpanded && shows.map((s, i) => (
              <a
                key={i}
                href={s.latestEpisode?.url || s.showUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cm-card"
                style={{
                  background: C.panel, border: `1px solid ${C.panelEdge}`,
                  borderRadius: 10, padding: "14px 18px", marginBottom: 12,
                  textDecoration: "none", color: C.ink,
                  display: "flex", alignItems: "center", gap: 14,
                }}
              >
                {s.coverArt ? (
                  <img src={s.coverArt} alt="" width={56} height={56}
                    style={{ borderRadius: 8, flexShrink: 0, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: 8, flexShrink: 0, background: C.panelEdge }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="cm-mono" style={{ fontSize: 10.5, color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {s.name}{s.latestEpisode?.isNew && <span style={{ color: C.accent }}> · ● NEW</span>}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, margin: "4px 0" }}>
                    {s.latestEpisode?.title || "Open on Spotify"}
                  </div>
                  {s.latestEpisode && (
                    <div className="cm-mono" style={{ fontSize: 11, color: C.faint }}>
                      {formatShortDate(s.latestEpisode.date)} · Spotify →
                    </div>
                  )}
                </div>
              </a>
            ))}

            <button onClick={() => setPodcastsExpanded((e) => !e)} className="cm-btn cm-mono cm-seemore">
              {podcastsExpanded ? "Show compact view ↑" : `See all ${shows.length} →`}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
