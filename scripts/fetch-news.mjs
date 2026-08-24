// Runs on a schedule via .github/workflows/fetch-news.yml (see that file for the
// cron). Calls the Anthropic API server-side — the API key never reaches the
// browser — and writes public/news.json, which the static frontend just reads.
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const PROMPT = `Search the web for the most recent news (last 48 hours preferred, past week acceptable) relevant to a critical-minerals analytical chemist. Cover a mix of these five beats:
- "supply": critical minerals policy, geopolitics, mining/supply-chain projects
- "funding": grants, VC rounds, and government funding for critical-minerals research, mining, or recycling startups
- "instrumentation": new ICP-MS/ICP-OES/XRF equipment, analytical method breakthroughs, vendor news (e.g. Thermo Fisher, Agilent, PerkinElmer)
- "economic": commodity prices, trade deals, market moves
- "science": recycling/recovery technology, geochemistry research

Return ONLY a JSON object, no preamble, no markdown fences, of this exact shape:
{
  "items": [
    {
      "headline": "concise factual headline",
      "summary": "2 sentence neutral summary of what happened and why it matters",
      "deepDive": "3-4 sentences of deeper background: key players, context, practical significance for the critical-minerals supply chain or lab workflow",
      "category": one of "supply" | "funding" | "instrumentation" | "economic" | "science",
      "minerals": ["2-4 relevant tags, e.g. Lithium, ICP-MS, Recycling, Grants"],
      "source": "publication name",
      "date": "approx date or 'recent'"
    }
  ]
}

Aim for 8-10 items with a real mix across all five categories — don't skip "funding" or "instrumentation". Prioritize concrete developments (deals, funding rounds, new instruments, regulations, breakthroughs, price moves) over general explainers. Respond with the raw JSON object only, and make sure it is complete and valid.`;

// Tolerant parse: recovers whole item objects even if the JSON tail got
// truncated or the model added stray text around the object.
function parseItems(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed.items) && parsed.items.length) return parsed.items;
  } catch {
    /* fall through to salvage */
  }
  const out = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const obj = JSON.parse(t.slice(objStart, i + 1));
          if (obj.headline) out.push(obj);
        } catch { /* skip unparseable fragment */ }
        objStart = -1;
      }
    }
  }
  return out;
}

async function fetchNews() {
  const messages = [{ role: "user", content: PROMPT }];
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }];

  let response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    tools,
    messages,
  });

  // A long chain of searches can pause; resume until the model actually finishes.
  while (response.stop_reason === "pause_turn") {
    messages.push({ role: "assistant", content: response.content });
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      tools,
      messages,
    });
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const items = parseItems(text);
  if (!items.length) {
    throw new Error("Model response had no parseable news items:\n" + text.slice(0, 2000));
  }
  return items;
}

const items = await fetchNews();
const payload = {
  generatedAt: new Date().toISOString(),
  items,
};

await writeFile(
  new URL("../public/news.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n",
);

console.log(`Wrote ${items.length} items to public/news.json`);
