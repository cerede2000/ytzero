import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { UserPlaylist } from "../api";
import { useI18n } from "../i18n";
import { filterPlaylistsByName, movePlaylistSearchIndex } from "../playlistSearch";
import { PlaylistIcon, PlaylistIconPicker } from "./PlaylistIcon";
import { Button, Input, Menu, MenuItem, MenuLoading, MenuStatus, ScrollArea, Stack } from "./ui";
import "./PlaylistPicker.css";

export interface PlaylistPickerProps {
  playlists: UserPlaylist[];
  loading?: boolean;
  name: string;
  icon: string;
  onNameChange: (name: string) => void;
  onIconChange: (icon: string) => void;
  onToggle: (playlist: UserPlaylist) => void;
  onCreate: () => void;
}

/** Shared contents for desktop and compact playlist menus. */
export default function PlaylistPicker({
  playlists,
  loading = false,
  name,
  icon,
  onNameChange,
  onIconChange,
  onToggle,
  onCreate,
}: PlaylistPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const resultListId = useId();
  const filteredPlaylists = useMemo(() => filterPlaylistsByName(playlists, query), [playlists, query]);
  const activePlaylist = filteredPlaylists[activeIndex];
  const activeItemId = activePlaylist ? `${resultListId}-playlist-${activePlaylist.id}` : undefined;

  useEffect(() => {
    if (activeIndex >= filteredPlaylists.length) setActiveIndex(-1);
  }, [activeIndex, filteredPlaylists.length]);

  useEffect(() => {
    if (activeItemId) document.getElementById(activeItemId)?.scrollIntoView({ block: "nearest" });
  }, [activeItemId]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => movePlaylistSearchIndex(current, filteredPlaylists.length, event.key === "ArrowDown" ? "next" : "previous"));
      return;
    }
    if (event.key === "Enter" && activePlaylist && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onToggle(activePlaylist);
    }
  };

  return <Menu className="playlist-picker">
      {loading ? <MenuLoading label={t("loading")} /> : <>
      <Input
        className="playlist-picker__search"
        size="sm"
        type="search"
        autoFocus
        value={query}
        placeholder={t("playlistSearchPlaceholder")}
        aria-label={t("playlistSearchPlaceholder")}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={resultListId}
        aria-activedescendant={activeItemId}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }}
        onKeyDown={handleSearchKeyDown}
      />
      <ScrollArea className="playlist-picker__list">
        <div id={resultListId} role="listbox" aria-label={t("myPlaylists")}>
          {filteredPlaylists.length === 0 && <div className="playlist-picker__empty">{query.trim() ? t("noMatchingPlaylists") : t("noPlaylists")}</div>}
          {filteredPlaylists.map((playlist, index) => (
            <MenuItem
              id={`${resultListId}-playlist-${playlist.id}`}
              role="option"
              aria-selected={playlist.has_video === 1}
              className={index === activeIndex ? "playlist-picker__item--active" : undefined}
              key={playlist.id}
              selected={playlist.has_video === 1}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => onToggle(playlist)}
              icon={<span className="playlist-picker__icon"><PlaylistIcon icon={playlist.icon} /></span>}
              suffix={playlist.has_video === 1 ? <MenuStatus><Check size={14} /></MenuStatus> : undefined}
            >
              {playlist.name}
            </MenuItem>
          ))}
        </div>
      </ScrollArea>
      <Button
        className="playlist-picker__create-toggle"
        size="sm"
        variant="ghost"
        leadingIcon={<Plus />}
        trailingIcon={creating ? <ChevronUp /> : <ChevronDown />}
        aria-expanded={creating}
        onClick={() => setCreating((value) => !value)}
      >
        {t("addPlaylist")}
      </Button>
      {creating && <Stack as="form" gap={2} className="playlist-picker__form" onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <div className="playlist-picker__form-row">
          <PlaylistIconPicker value={icon} onChange={onIconChange} compact />
          <Input
            size="sm"
            autoFocus
            value={name}
            placeholder={t("name")}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>{t("createAndAdd")}</Button>
      </Stack>}
      </>}
  </Menu>;
}
