// Runs on a schedule via .github/workflows/fetch-news.yml. Pulls the latest
// episode for each tracked show straight from Spotify's public embed page
// (open.spotify.com/embed/show/<id>) — no login, no API key. The embed page
// ships a __NEXT_DATA__ JSON blob with the show's most recent episode, cover
// art, and release date, which is both simpler and more reliable than mixing
// per-show RSS feeds with the Spotify Web API (which gates episode listing
// behind a 250k-MAU "Extended Quota Mode" we'll never hit).
import { writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const NEW_WITHIN_DAYS = 3;

const SHOWS = [
  { name: "Café da Manhã", spotifyId: "6WRTzGhq3uFxMrxHrHh1lo" },
  { name: "Posse de Bola", spotifyId: "5P157mPqe1KiFcrNX56YBz" },
  { name: "WSJ What's News", spotifyId: "59176gU8vcFho6Sc1dm3Lu" },
  { name: "Chain Reaction by ACS", spotifyId: "7dSHR4UqvZjX3I9mZ4rBlu" },
  { name: "Stereo Chemistry", spotifyId: "7LuXGgxffat3bQZ5uEHL3i" },
];

async function fetchShow({ name, spotifyId }) {
  const showUrl = `https://open.spotify.com/show/${spotifyId}`;
  try {
    const res = await fetch(`https://open.spotify.com/embed/show/${spotifyId}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`Skipping ${name}: HTTP ${res.status}`);
      return { name, showUrl, latestEpisode: null };
    }
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!match) {
      console.warn(`Skipping ${name}: couldn't find __NEXT_DATA__ on embed page`);
      return { name, showUrl, latestEpisode: null };
    }

    const data = JSON.parse(match[1]);
    const entity = data?.props?.pageProps?.state?.data?.entity;
    if (!entity || entity.type !== "episode") {
      console.warn(`Skipping ${name}: embed page didn't resolve to an episode`);
      return { name, showUrl, latestEpisode: null };
    }

    const episodeId = String(entity.uri || "").split(":").pop();
    const releaseIso = entity.releaseDate?.isoString || null;
    const releaseDate = releaseIso ? new Date(releaseIso) : null;
    const isNew = releaseDate && !isNaN(releaseDate)
      ? Date.now() - releaseDate.getTime() < NEW_WITHIN_DAYS * 24 * 60 * 60 * 1000
      : false;

    const coverArt = Array.isArray(entity.relatedEntityCoverArt)
      ? entity.relatedEntityCoverArt.sort((a, b) => b.maxWidth - a.maxWidth)[0]?.url
      : null;

    return {
      name,
      showUrl,
      coverArt: coverArt || null,
      latestEpisode: {
        title: entity.title || entity.name || "Latest episode",
        date: releaseDate && !isNaN(releaseDate) ? releaseDate.toISOString().slice(0, 10) : null,
        url: episodeId ? `https://open.spotify.com/episode/${episodeId}` : showUrl,
        isNew,
      },
    };
  } catch (e) {
    console.warn(`Skipping ${name}: ${e.message}`);
    return { name, showUrl, latestEpisode: null };
  }
}

async function fetchPodcasts() {
  return Promise.all(SHOWS.map(fetchShow));
}

const shows = await fetchPodcasts();

const payload = {
  generatedAt: new Date().toISOString(),
  shows,
};

await writeFile(
  new URL("../public/podcasts.json", import.meta.url),
  JSON.stringify(payload, null, 2) + "\n",
);

console.log(`Wrote ${shows.length} shows to public/podcasts.json`);
