// Runs on a schedule via .github/workflows/fetch-news.yml. Pulls spot prices
// for silver, platinum, palladium, and rhodium from MetalpriceAPI's free tier.
// Requires METALPRICE_API_KEY (free signup, no card: metalpriceapi.com).
import { writeFile } from "node:fs/promises";

const METALS = [
  { symbol: "XAG", name: "Silver" },
  { symbol: "XPT", name: "Platinum" },
  { symbol: "XPD", name: "Palladium" },
  { symbol: "XRH", name: "Rhodium" },
];

async function fetchPrices() {
  const apiKey = process.env.METALPRICE_API_KEY;
  if (!apiKey) {
    console.warn("METALPRICE_API_KEY not set — writing empty prices.json");
    return [];
  }

  const symbols = METALS.map((m) => m.symbol).join(",");
  const url = `https://api.metalpriceapi.com/v1/latest?api_key=${apiKey}&base=USD&currencies=${symbols}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      console.warn(`MetalpriceAPI error: ${data.error?.info || res.status}`);
      return [];
    }

    return METALS
      .map((m) => {
        const usdPerOz = data.rates?.[`USD${m.symbol}`];
        if (typeof usdPerOz !== "number") {
          console.warn(`No rate for ${m.name} (${m.symbol}) — omitting`);
          return null;
        }
        return { symbol: m.symbol, name: m.name, usdPerOz: Math.round(usdPerOz * 100) / 100 };
      })
      .filter(Boolean);
  } catch (e) {
    console.warn(`MetalpriceAPI: ${e.message}`);
    return [];
  }
}

const metals = await fetchPrices();

const payload = {
  generatedAt: new Date().toISOString(),
  metals,
};

await writeFile(
  new URL("../public/prices.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n",
);

console.log(`Wrote ${metals.length} metal prices to public/prices.json`);
