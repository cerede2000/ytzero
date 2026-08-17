import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Clock, Search, X } from "lucide-react";
import { api, type SearchSuggestChannel } from "../api";
import { FloatingPopover } from "../components/ui";
import { useI18n } from "../i18n";
import { img } from "../img";
import { forgetSearch, matchingRecentSearches, readRecentSearches, rememberSearch, withRecentSearch } from "../recentSearches";
import "./AppSearchBox.css";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 160;

/** A channel jump or a query completion, flattened so one index can walk both. */
type Entry =
  | { kind: "channel"; channel: SearchSuggestChannel }
  | { kind: "query"; query: string }
  | { kind: "recent"; query: string };

/**
 * The top bar's search field with type-ahead. Followed channels come from the
 * local library (so the box can jump straight to a channel) and completions
 * from YouTube's suggestion service, both via one debounced request that is
 * aborted whenever the next keystroke lands.
 */
export default function AppSearchBox() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The list matches the field's width, which shrinks with the top bar, so the
  // popover can't end up wider than what it belongs to.
  const [width, setWidth] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set while navigating from a chosen entry, so the value change it causes
  // doesn't immediately re-open the list behind the new page.
  const suppressRef = useRef(false);
  // Bumped whenever the list is closed on purpose. A completion already on its
  // way answers into a box the reader has finished with, and re-opened the list
  // behind the page they had just asked for — often enough to be maddening,
  // rarely enough to look random, because it depends on where the reply lands
  // relative to the Enter.
  const requestRef = useRef(0);
  const [recentEnabled, setRecentEnabled] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);
  recentRef.current = recentEnabled ? recent : [];

  // The plugin owns whether this is offered at all, so it is asked once rather
  // than assumed: a profile that turned it off should not have a list built for
  // it in the background.
  useEffect(() => {
    let cancelled = false;
    api.pluginSettings("search-suggest")
      .then((r) => {
        if (cancelled) return;
        const on = String(r.settings?.search_recent ?? "1") === "1";
        setRecentEnabled(on);
        setRecent(on ? readRecentSearches() : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => setQ(params.get("q") ?? ""), [params]);

  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    const query = q.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      // Arriving at an empty box, what is offered is what this profile searched
      // for — there is nothing to complete yet, and that is the moment those are
      // most useful.
      const mine = recentEnabled ? matchingRecentSearches(recent, query) : [];
      setEntries(mine.map((entry) => ({ kind: "recent" as const, query: entry })));
      setActive(-1);
      setWidth(formRef.current?.getBoundingClientRect().width ?? 0);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(() => {
      api.searchSuggest(query, language, controller.signal)
        .then((r) => {
          if (requestId !== requestRef.current) return;
          // The reader's own searches first, then the channels they follow,
          // then what everyone else is looking for. A completion that repeats a
          // recent search is dropped rather than shown twice.
          const mine = matchingRecentSearches(recentRef.current, query);
          const seen = new Set(mine.map((entry) => entry.toLowerCase()));
          const next: Entry[] = [
            ...mine.map((entry) => ({ kind: "recent" as const, query: entry })),
            ...r.channels.map((channel) => ({ kind: "channel" as const, channel })),
            ...r.suggestions
              .filter((suggestion) => !seen.has(suggestion.toLowerCase()))
              .map((query) => ({ kind: "query" as const, query })),
          ];
          setEntries(next);
          setActive(-1);
          setWidth(formRef.current?.getBoundingClientRect().width ?? 0);
          setOpen(next.length > 0);
        })
        // An aborted keystroke or a suggestion outage simply leaves the list be.
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, language, recent, recentEnabled]);

  const close = () => {
    // Any completion still on its way is no longer wanted. Without this the
    // reply lands after the list was closed and opens it again.
    requestRef.current++;
    setOpen(false);
    setActive(-1);
  };

  const remember = (query: string) => {
    if (!recentEnabled) return;
    rememberSearch(query);
    setRecent((current) => withRecentSearch(current, query));
  };

  const forget = (query: string) => {
    forgetSearch(query);
    setRecent((current) => current.filter((entry) => entry !== query));
  };

  const go = (path: string) => {
    suppressRef.current = true;
    close();
    inputRef.current?.blur();
    navigate(path);
  };

  const choose = (entry: Entry) => {
    if (entry.kind === "channel") {
      go(`/channel/${entry.channel.channel_id}`);
      return;
    }
    setQ(entry.query);
    remember(entry.query);
    go(`/search?q=${encodeURIComponent(entry.query)}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (active >= 0 && entries[active]) {
      choose(entries[active]);
      return;
    }
    close();
    inputRef.current?.blur();
    if (q.trim()) remember(q.trim());
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (!open || entries.length === 0) return;
    // Taking Enter here rather than leaving it to the form's implicit submit
    // keeps "open the highlighted entry" from also submitting the raw text.
    if (event.key === "Enter" && active >= 0 && entries[active]) {
      event.preventDefault();
      choose(entries[active]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // -1 is "nothing highlighted, submit what I typed", so the ring runs
      // from -1 through the entries and back.
      setActive((current) => {
        const next = current + step;
        if (next >= entries.length) return -1;
        if (next < -1) return entries.length - 1;
        return next;
      });
    }
  };

  const optionId = (index: number) => `search-suggest-option-${index}`;

  return (
    <FloatingPopover
      open={open && entries.length > 0}
      onOpenChange={(next) => { if (!next) close(); }}
      align="start"
      toggleOnTriggerClick={false}
      triggerClassName="search-anchor"
      className="search-suggest"
      gap={4}
      trigger={
        <form ref={formRef} className="search-wrap" onSubmit={submit} role="search">
          <input
            ref={inputRef}
            placeholder={t("searchPlaceholder")}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (entries.length > 0) { setOpen(true); return; }
              // Nothing typed and nothing fetched: the recent list is all there
              // is to show, and showing it is the point.
              const mine = recentEnabled ? matchingRecentSearches(recentRef.current, "") : [];
              if (mine.length === 0) return;
              setEntries(mine.map((entry) => ({ kind: "recent" as const, query: entry })));
              setWidth(formRef.current?.getBoundingClientRect().width ?? 0);
              setOpen(true);
            }}
            role="combobox"
            aria-expanded={open && entries.length > 0}
            aria-controls="search-suggest-list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <button type="submit" className="search-btn" aria-label={t("search")}>
            <Search />
          </button>
        </form>
      }
    >
      <ul
        className="search-suggest-list"
        id="search-suggest-list"
        role="listbox"
        aria-label={t("searchSuggestions")}
        style={width ? { width: `${width - 12}px` } : undefined}
      >
        {entries.map((entry, index) => (
          <li key={entry.kind === "channel" ? entry.channel.channel_id : entry.kind + ":" + entry.query} className={entry.kind === "recent" ? "search-suggest-row is-recent" : "search-suggest-row"} role="none">
            <button
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={`search-suggest-option${index === active ? " is-active" : ""}`}
              // The input must keep focus so typing continues after a hover.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(entry)}
            >
              {entry.kind === "channel" ? (
                <>
                  <img className="search-suggest-avatar" src={img(entry.channel.thumbnail)} alt="" loading="lazy" />
                  <span className="search-suggest-label">{entry.channel.title}</span>
                  <span className="search-suggest-kind">{t("searchSuggestionChannel")}</span>
                </>
              ) : entry.kind === "recent" ? (
                <>
                  <Clock className="search-suggest-icon" size={16} aria-hidden="true" />
                  <span className="search-suggest-label">{entry.query}</span>
                  <span className="search-suggest-kind">{t("searchSuggestionRecent")}</span>
                </>
              ) : (
                <>
                  <Search className="search-suggest-icon" size={16} aria-hidden="true" />
                  <span className="search-suggest-label">{entry.query}</span>
                </>
              )}
            </button>
            {/* Beside the option rather than inside it: a button nested in a
                button is not something a browser or a keyboard handles well. */}
            {entry.kind === "recent" && (
              <button
                type="button"
                className="search-suggest-forget"
                aria-label={t("searchSuggestionForget")}
                title={t("searchSuggestionForget")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => forget(entry.query)}
              ><X size={14} /></button>
            )}
          </li>
        ))}
      </ul>
    </FloatingPopover>
  );
}
