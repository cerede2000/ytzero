import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headphones, ListVideo, Play, Save, Trash2, X } from "lucide-react";
import { api } from "../api";
import { setProfileAudioMode } from "../audioModePreference";
import { emit, emitToast } from "../events";
import { useI18n } from "../i18n";
import { img } from "../img";
import { clearSessionQueue, removeFromSessionQueue, useSessionQueue, type SessionQueueEntry } from "../sessionQueue";
import type { PlaybackQueueContext } from "../playbackQueue";
import { Button, FloatingPopover, MenuItem, ScrollArea, SplitButton } from "./ui";
import "./PlayQueueMenu.css";

function queueContext(entries: readonly SessionQueueEntry[]): PlaybackQueueContext {
  return { version: 1, kind: "session", ids: entries.map((entry) => entry.videoId) };
}

export default function PlayQueueMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queue = useSessionQueue();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * `audio` left out means "however this browser was last playing" — that is
   * what pressing an entry in the list asks for. The two buttons below state a
   * mode instead, and a stated mode is written down as well as travelled with:
   * the queue plays on past this video, and the ones after it open the way this
   * one was asked for.
   */
  const playFrom = (videoId: string, audio?: boolean) => {
    setOpen(false);
    if (audio !== undefined) setProfileAudioMode(audio);
    // fromStart: pressing play on a list is starting the list, not resuming
    // whatever position the first entry happens to remember.
    navigate(`/watch/${videoId}`, { state: { playbackQueue: queueContext(queue), fromStart: true, audio } });
  };

  /**
   * Write the queue down as a playlist.
   *
   * Videos are added one after another rather than all at once: the order is
   * the queue's order, and the position each entry gets is the position it is
   * added in.
   */
  const saveAsPlaylist = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const created = await api.createUserPlaylist({ name: trimmed, icon: "ListVideo" });
      for (const entry of queue) await api.addVideoToUserPlaylist(created.playlist.id, entry.videoId);
      emit("playlists-changed");
      emitToast(t("playQueueSaved", { name: trimmed }), "success");
      setNaming(false);
      setName("");
    } catch {
      emitToast(t("error"), "danger");
    } finally {
      setSaving(false);
    }
  };

  const trigger = (
    <button
      type="button"
      className={`play-queue-trigger${queue.length > 0 ? " play-queue-trigger--filled" : ""}`}
      aria-label={t("playQueue")}
      title={t("playQueue")}
      onClick={() => setOpen((current) => !current)}
    >
      <ListVideo size={20} />
      {queue.length > 0 && <span className="play-queue-trigger__count">{queue.length}</span>}
    </button>
  );

  return (
    <FloatingPopover open={open} onOpenChange={setOpen} align="end" trigger={trigger} toggleOnTriggerClick={false} className="play-queue-menu">
      <div className="play-queue-head">
        <span className="play-queue-title">{t("playQueue")}</span>
        {queue.length > 0 && <span className="play-queue-count">{t("playQueueCount", { n: queue.length })}</span>}
      </div>

      {queue.length === 0 ? (
        <p className="play-queue-empty">{t("playQueueEmpty")}</p>
      ) : (
        <>
          <ScrollArea className="play-queue-scroll" viewportClassName="play-queue-list">
            {queue.map((entry) => (
              <div key={entry.videoId} className="play-queue-item">
                <button type="button" className="play-queue-item__open" onClick={() => playFrom(entry.videoId)}>
                  <span className="play-queue-item__thumb">
                    {entry.thumbnail && <img src={img(entry.thumbnail)} alt="" loading="lazy" />}
                    {entry.duration && <span className="play-queue-item__duration">{entry.duration}</span>}
                  </span>
                  <span className="play-queue-item__text">
                    <span className="play-queue-item__title">{entry.title}</span>
                    <span className="play-queue-item__channel">{entry.channelTitle}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="play-queue-item__remove"
                  aria-label={t("playQueueRemove")}
                  title={t("playQueueRemove")}
                  onClick={() => removeFromSessionQueue(entry.videoId)}
                ><X size={15} /></button>
              </div>
            ))}
          </ScrollArea>

          <p className="play-queue-hint">{t("playQueueHint")}</p>

          {naming ? (
            <form
              className="play-queue-save"
              onSubmit={(event) => { event.preventDefault(); void saveAsPlaylist(); }}
            >
              <input
                className="ui-input"
                autoFocus
                value={name}
                placeholder={t("playQueue")}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || saving}>{t("playQueueSave")}</Button>
            </form>
          ) : (
            <div className="play-queue-actions">
              <SplitButton
                variant="primary"
                size="sm"
                leadingIcon={<Play size={15} />}
                menuLabel={t("playlistPlayModes")}
                onClick={() => playFrom(queue[0].videoId, false)}
                menu={<MenuItem icon={<Headphones />} onClick={() => playFrom(queue[0].videoId, true)}>{t("playQueuePlayAudio")}</MenuItem>}
              >{t("playQueuePlay")}</SplitButton>
              <Button variant="ghost" size="sm" leadingIcon={<Save size={15} />} onClick={() => setNaming(true)}>{t("playQueueSave")}</Button>
              <Button variant="ghost" size="sm" leadingIcon={<Trash2 size={15} />} onClick={clearSessionQueue}>{t("playQueueClear")}</Button>
            </div>
          )}
        </>
      )}
    </FloatingPopover>
  );
}
