import { Link } from "react-router-dom";
import { dailymotionClock, type DailymotionVideo } from "../dailymotionTypes";

/**
 * One result, linking to the player page.
 *
 * Plain <img> rather than the shared thumbnail component: the image proxy
 * trusts only Google's hosts, and widening that list is a change to code this
 * experiment is meant to leave alone.
 */
export default function DailymotionCard({ video, compact = false }: { video: DailymotionVideo; compact?: boolean }) {
  return (
    <Link className={`dm-card${compact ? " dm-card--row" : ""}`} to={`/dailymotion/video/${video.videoId}`}>
      <span className="dm-thumb">
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
        {video.durationSeconds != null && <span className="dm-duration">{dailymotionClock(video.durationSeconds)}</span>}
      </span>
      <span className="dm-card-text">
        <span className="dm-title">{video.title}</span>
        <span className="dm-channel">{video.channelTitle}</span>
      </span>
    </Link>
  );
}
