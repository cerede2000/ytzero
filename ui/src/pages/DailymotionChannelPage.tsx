import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import DailymotionCard from "../components/DailymotionCard";
import { EmptyState, PageHeader } from "../components/ui";
import { dailymotionCount, type DailymotionChannel, type DailymotionVideo } from "../dailymotionTypes";
import { useDocumentTitle } from "../useDocumentTitle";
import "./DailymotionPage.css";

interface Playlist { playlistId: string; name: string; thumbnail: string; videos: number | null }
interface ChannelPage {
  channel: DailymotionChannel & { description: string };
  videos: DailymotionVideo[];
  playlists: Playlist[];
}

/**
 * A channel, reached from a search result.
 *
 * The link existed before the page did — a result led here and here was
 * nothing. This is also where playlists come back: searching for one needs an
 * account, but a named channel's own are public, so the way to a playlist is
 * through whoever made it.
 */
export default function DailymotionChannelPage() {
  const { id = "" } = useParams();
  const [page, setPage] = useState<ChannelPage | null>(null);
  const [missing, setMissing] = useState(false);
  useDocumentTitle(page?.channel.name ?? "Dailymotion");

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setMissing(false);
    void fetch(`/api/dailymotion/channels/${id}`)
      .then(async (response) => {
        if (!response.ok) { if (!cancelled) setMissing(true); return; }
        const payload = await response.json() as ChannelPage;
        if (!cancelled) setPage(payload);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [id]);

  if (missing) return <EmptyState title="Chaîne introuvable" description="Cette chaîne n'existe plus chez Dailymotion." />;
  if (!page) return <PageHeader title="Dailymotion" />;

  const { channel, videos, playlists } = page;
  return (
    <>
      <PageHeader title={channel.name} />
      <div className="dm-channel-head">
        {channel.avatar && <img src={channel.avatar} alt="" />}
        <div>
          <p className="dm-channel-counts">
            {[dailymotionCount(channel.videos, "vidéo"), dailymotionCount(channel.followers, "abonné")].filter(Boolean).join(" · ")}
          </p>
          {channel.description && <p className="dm-watch-desc">{channel.description}</p>}
        </div>
      </div>

      {playlists.length > 0 && (
        <section className="dm-section">
          <h2 className="dm-section-title">Playlists</h2>
          <div className="dm-grid">
            {playlists.map((playlist) => (
              <div key={playlist.playlistId} className="dm-card">
                <span className="dm-thumb">
                  {playlist.thumbnail && <img src={playlist.thumbnail} alt="" loading="lazy" />}
                </span>
                <span className="dm-card-text">
                  <span className="dm-title">{playlist.name}</span>
                  <span className="dm-channel">{dailymotionCount(playlist.videos, "vidéo")}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dm-section">
        <h2 className="dm-section-title">Vidéos</h2>
        {videos.length === 0
          ? <EmptyState title="Aucune vidéo" description="Cette chaîne n'a rien de lisible ici." />
          : <div className="dm-grid">{videos.map((video) => <DailymotionCard key={video.videoId} video={video} />)}</div>}
      </section>
    </>
  );
}
