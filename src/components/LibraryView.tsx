import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Focusable } from "@decky/ui";
import { FaFolderOpen, FaSteam, FaTrash } from "react-icons/fa";
import { InstalledGame, StorageInfo } from "../types";
import { boxRatio, formatBytes, systemLabel } from "./common";
import CoverImage from "./CoverImage";
import { NoArt } from "./RomCard";
import { childFocus, focusElement } from "./gamepad";
import ModsPanel from "./ModsPanel";
import { useBackGuard } from "./useBackGuard";
import { EmptyState, Spinner } from "./ui";

interface Props {
  games: InstalledGame[] | null;
  root: string;
  /** The drives a download can go to, with their free space. */
  storage: StorageInfo[];
  /** Open with this game focused (from the home screen). */
  focusId?: string | null;
  onUninstall: (game: InstalledGame) => Promise<boolean>;
  /** Y: the game's page in the store. */
  onStorePage: (item: { title: string; system: string; cover?: string | null }) => void;
  onBrowse: () => void;
}

const SORTS = [
  { value: "console", label: "By console" },
  { value: "recent", label: "Newest first" },
  { value: "size", label: "Largest first" },
  { value: "title", label: "A → Z" },
];

/**
 * The Library tab: what is on the Deck, how much room it takes, and a way to
 * take a game off again.
 *
 * Uninstalling deletes files, so it always asks first, in the game's own card:
 * "Delete 3 files, 1.2 GB?" with Keep focused, so pressing A twice by accident
 * does nothing. Gamepad: a grid of games; A uninstalls, Y opens the store page.
 */
const LibraryView: FC<Props> = ({ games, root, storage, focusId, onUninstall, onStorePage, onBrowse }) => {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sort, setSort] = useState("console");
  // The game whose page (mods, uninstall) is open.
  const [open, setOpen] = useState<InstalledGame | null>(null);

  const total = (games ?? []).reduce((sum, game) => sum + game.size, 0);

  // One list per console, or one list for everything in the picked order.
  const groups = useMemo<[string | null, InstalledGame[]][]>(() => {
    const list = [...(games ?? [])];
    if (sort === "console") {
      const map = new Map<string, InstalledGame[]>();
      list.forEach((game) => map.set(game.system, [...(map.get(game.system) ?? []), game]));
      return Array.from(map.entries());
    }
    if (sort === "size") list.sort((a, b) => b.size - a.size);
    else if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else list.sort((a, b) => b.modified - a.modified);
    return list.length ? [[null, list]] : [];
  }, [games, sort]);

  // Start on the game that was picked on the home screen, else the first one.
  useEffect(() => {
    if (!games) return;
    window.requestAnimationFrame(() => {
      const view = viewRef.current;
      const active = document.activeElement;
      // Only from the tab bar or from nowhere: never take focus the player moved.
      if (!view || (active && active !== document.body && !active.matches(".rs-tab"))) return;
      focusElement((focusId ? card(focusId) : null) ?? view.querySelector(".rs-lib-card, .rs-empty .rs-btn"));
    });
  }, [games !== null]);

  // By attribute value, not by selector: a file name can hold any character.
  const card = (id: string) =>
    Array.from(viewRef.current?.querySelectorAll("[data-game]") ?? []).find((el) => el.getAttribute("data-game") === id) ?? null;

  const ask = (game: InstalledGame) => {
    setConfirming(game.id);
    // The safe answer has focus.
    window.requestAnimationFrame(() => focusElement(card(game.id)?.querySelector(".rs-lib-keep")));
  };

  const keep = (game: Pick<InstalledGame, "id">) => {
    setConfirming(null);
    window.requestAnimationFrame(() => focusElement(card(game.id)));
  };
  // B answers the question with "Keep".
  useBackGuard(confirming !== null && busy === null, () => {
    if (confirming) keep({ id: confirming });
  });

  const remove = async (game: InstalledGame) => {
    setBusy(game.id);
    // Focus moves to the next game before this one disappears.
    const cards = Array.from(viewRef.current?.querySelectorAll("[data-game]") ?? []);
    const at = cards.findIndex((item) => item.getAttribute("data-game") === game.id);
    const next = (cards[at + 1] ?? cards[at - 1])?.getAttribute("data-game");
    const ok = await onUninstall(game);
    setBusy(null);
    setConfirming(null);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        focusElement(
          (ok ? (next ? card(next) : null) : card(game.id)) ?? viewRef.current?.querySelector(".rs-lib-card, .rs-empty .rs-btn"),
        ),
      ),
    );
  };

  const closePage = () => {
    const id = open?.id;
    setOpen(null);
    if (id) window.requestAnimationFrame(() => focusElement(card(id)));
  };

  return (
    <>
    <Focusable noFocusRing
      ref={viewRef}
      className={`rs-view rs-scroll${games && games.length === 0 ? " is-empty" : ""}`}
      data-view="library"
      flow-children="column"
      {...childFocus(open === null)}
    >
      <Focusable noFocusRing className="rs-view-head" flow-children="row">
        <div className="rs-view-title">
          <h1 className="rs-h1">Library</h1>
          <span className="rs-count">
            {games ? `${games.length} ${games.length === 1 ? "game" : "games"} · ${formatBytes(total) || "0B"}` : "Looking…"}
          </span>
        </div>
        {games && games.length > 1 ? (
          <div className="rs-filter">
            <Dropdown
              rgOptions={SORTS.map((item) => ({ label: item.label, data: item.value }))}
              selectedOption={sort}
              onChange={(option) => setSort(option.data)}
              menuLabel="Sort"
            />
          </div>
        ) : null}
      </Focusable>

      {storage.length ? (
        <div className="rs-drives">
          {storage.map((drive) => {
            const used = Math.max(0, drive.total - drive.free);
            const roms = (games ?? []).filter((game) => game.folder.startsWith(drive.root)).reduce((sum, game) => sum + game.size, 0);
            const pct = (value: number) => `${drive.total ? Math.min(100, (value / drive.total) * 100) : 0}%`;
            return (
              <div className="rs-drive" key={drive.root}>
                <div className="rs-drive-top">
                  <span className="rs-drive-name">{drive.label}</span>
                  <span className="rs-drive-free">{formatBytes(drive.free)} free</span>
                </div>
                <div className="rs-drive-bar">
                  <span className="roms" style={{ width: pct(roms) }} />
                  <span className="other" style={{ width: pct(Math.max(0, used - roms)) }} />
                </div>
                <div className="rs-drive-sub">
                  {roms ? `${formatBytes(roms)} of games · ` : ""}
                  {formatBytes(drive.total)} in total
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {games === null ? (
        <div className="rs-loading">
          <Spinner /> Reading the library…
        </div>
      ) : null}

      {games && games.length === 0 ? (
        <EmptyState
          icon={<FaFolderOpen />}
          title="No games yet"
          action={
            <Button noFocusRing className="rs-btn" onClick={onBrowse}>
              Browse the store
            </Button>
          }
        >
          Downloads land in <span className="rs-path">{root || "your ROM folder"}</span>, sorted by console, and show up
          here.
        </EmptyState>
      ) : null}

      {groups.map(([system, list]) => (
        <section key={system ?? "all"} className="rs-section rs-lib-group">
          {system ? (
            <div className="rs-section-head">
              <h2 className="rs-h2">{systemLabel(system)}</h2>
              <span className="rs-count">
                {list.length} · {formatBytes(list.reduce((sum, game) => sum + game.size, 0))}
              </span>
            </div>
          ) : null}
          <Focusable noFocusRing className="rs-lib-grid" flow-children="grid">
            {list.map((game) => {
              const files = game.files.length;
              const thumb = (
                <div className="rs-lib-thumb" style={{ aspectRatio: String(Math.min(1.45, Math.max(0.6, boxRatio(game.system)))) }}>
                  {game.cover ? <CoverImage url={game.cover} alt="" /> : <NoArt title="" system={game.system} />}
                </div>
              );
              if (confirming === game.id) {
                return (
                  <div key={game.id} className="rs-lib-card asking" data-game={game.id}>
                    {thumb}
                    <div className="rs-lib-main">
                      <div className="rs-lib-title">{game.title}</div>
                      <div className="rs-lib-meta">
                        Delete {files} {files === 1 ? "file" : "files"}, {formatBytes(game.size)}? This cannot be undone.
                      </div>
                    </div>
                    <Focusable noFocusRing className="rs-actions" flow-children="row">
                      <Button noFocusRing className="rs-btn ghost rs-lib-keep" onClick={() => keep(game)} onOKActionDescription="Keep">
                        Keep
                      </Button>
                      <Button noFocusRing
                        className="rs-btn danger rs-lib-delete"
                        disabled={busy === game.id}
                        onClick={() => remove(game)}
                        onOKActionDescription="Delete"
                      >
                        <FaTrash /> {busy === game.id ? "Deleting…" : "Delete"}
                      </Button>
                    </Focusable>
                  </div>
                );
              }
              return (
                <Focusable noFocusRing
                  key={game.id}
                  className="rs-lib-card rs-f"
                  data-game={game.id}
                  focusClassName="is-focus"
                  onActivate={() => setOpen(game)}
                  onClick={() => setOpen(game)}
                  onOKActionDescription="Mods"
                  onSecondaryButton={() => ask(game)}
                  onSecondaryActionDescription="Uninstall"
                  onOptionsButton={() => onStorePage({ title: game.title, system: game.system, cover: game.cover })}
                  onOptionsActionDescription="Store page"
                >
                  {thumb}
                  <div className="rs-lib-main">
                    <div className="rs-lib-title" title={game.files.map((file) => file.name).join("\n")}>
                      {game.title}
                    </div>
                    <div className="rs-lib-meta">
                      {system ? null : <span>{systemLabel(game.system)}</span>}
                      {files > 1 ? <span>{files} files</span> : null}
                      {game.in_steam ? (
                        <span className="rs-lib-steam" title="In your Steam library">
                          <FaSteam /> In Steam
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="rs-lib-size">{formatBytes(game.size)}</span>
                </Focusable>
              );
            })}
          </Focusable>
        </section>
      ))}
    </Focusable>
    {open ? (
      <ModsPanel
        game={open}
        onClose={closePage}
        onUninstall={() => {
          const game = open;
          setOpen(null);
          window.setTimeout(() => ask(game), 0);
        }}
        onStorePage={() => onStorePage({ title: open.title, system: open.system, cover: open.cover })}
      />
    ) : null}
    </>
  );
};

export default LibraryView;
