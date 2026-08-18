import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { Radio, Search } from "lucide-react";
import DailymotionCard from "../components/DailymotionCard";
import { Button, EmptyState, Input, PageHeader } from "../components/ui";
import { dailymotionCount, type DailymotionSearch } from "../dailymotionTypes";
import { useDocumentTitle } from "../useDocumentTitle";
import "./DailymotionPage.css";

/**
 * Searching Dailymotion, on the shelves their own results page uses.
 *
 * Nothing plays here any more: a result is a link to the player page, which is
 * where a video belongs. Videos, channels and what is on air are asked for
 * independently, so a search that finds no channels still shows its videos.
 *
 * Playlists are absent because their API refuses to search them without an
 * account — `/playlists?search=` answers 403 — not because they were forgotten.
 */
export default function DailymotionPage() {
  useDocumentTitle("Dailymotion");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DailymotionSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  const search = useCallback(async (term: string) => {
    if (!term.trim()) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/dailymotion/search/all?q=${encodeURIComponent(term.trim())}`);
      const payload = await response.json() as DailymotionSearch & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
      setResults(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setResults({ videos: [], channels: [], live: [] });
    } finally {
      setSearching(false);
    }
  }, []);

  const empty = results && results.videos.length === 0 && results.channels.length === 0 && results.live.length === 0;

  return (
    <>
      <PageHeader title="Dailymotion" />
      <form className="dm-search" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
        <Input value={query} placeholder="Rechercher sur Dailymotion…" onChange={(event) => setQuery(event.target.value)} />
        <Button type="submit" variant="primary" leadingIcon={<Search size={16} />} disabled={searching || !query.trim()}>
          {searching ? "Recherche…" : "Rechercher"}
        </Button>
      </form>

      {error && <p className="dm-error">{error}</p>}
      {empty && !searching && !error && <EmptyState title="Aucun résultat" description="Essayez d'autres mots." />}

      {results && results.live.length > 0 && (
        <section className="dm-section">
          <h2 className="dm-section-title"><Radio size={15} /> En direct</h2>
          <div className="dm-grid">
            {results.live.map((video) => <DailymotionCard key={video.videoId} video={video} />)}
          </div>
        </section>
      )}

      {results && results.channels.length > 0 && (
        <section className="dm-section">
          <h2 className="dm-section-title">Chaînes</h2>
          <div className="dm-channels">
            {results.channels.map((channel) => (
              <Link key={channel.channelId} className="dm-channel-card" to={`/dailymotion/channel/${channel.channelId}`}>
                {channel.avatar && <img src={channel.avatar} alt="" loading="lazy" />}
                <span>
                  <strong>{channel.name}</strong>
                  <small>{[dailymotionCount(channel.videos, "vidéo"), dailymotionCount(channel.followers, "abonné")].filter(Boolean).join(" · ")}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {results && results.videos.length > 0 && (
        <section className="dm-section">
          <h2 className="dm-section-title">Vidéos</h2>
          <div className="dm-grid">
            {results.videos.map((video) => <DailymotionCard key={video.videoId} video={video} />)}
          </div>
        </section>
      )}
    </>
  );
}
