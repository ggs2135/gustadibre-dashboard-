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
  { id: "funding", label: "Funding & Investment", color: "#8C7AE6" },
  { id: "instrumentation", label: "Instrumentation & Lab Tech" }, // falls back to accent
  { id: "economic", label: "Markets & Economics", color: "#D97757" },
  { id: "science", label: "Science & Recovery", color: "#6FBF73" },
];

const MINERAL_TAGS = [
  "Rare earths", "Lithium", "Cobalt", "Nickel", "Copper",
  "Graphite", "Gallium", "Germanium", "Recycling", "Tailings",
  "ICP-MS", "ICP-OES", "XRF", "Assay methods", "Grants", "Venture capital",
];

// News is generated on a schedule (see scripts/fetch-news.mjs and
// .github/workflows/fetch-news.yml) and committed as this static file.
// The frontend never calls the Anthropic API directly.
const NEWS_URL = "./news.json";

const THEME_KEY = "gd-theme";

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

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "24px 0 28px" }}>
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

        {!loading && !error && filtered.map((it, i) => {
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

        {/* Footer */}
        {!loading && !error && (
          <div className="cm-mono" style={{
            color: C.faint, fontSize: 11, marginTop: 32,
            paddingTop: 18, borderTop: `1px solid ${C.line}`, lineHeight: 1.6,
          }}>
            Headlines are pulled automatically from mining, chemistry, and funding
            RSS feeds once daily and sorted by keyword — not AI-summarized. Category
            and tag matching is approximate; click through to the source for the
            full story.
          </div>
        )}
      </div>
    </div>
  );
}
