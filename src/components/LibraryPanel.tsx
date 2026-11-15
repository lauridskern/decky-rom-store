import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Button, Focusable } from "@decky/ui";
import { FaSteam, FaTrash } from "react-icons/fa";
import { InstalledGame } from "../types";
import { formatBytes, systemLabel } from "./common";
import { focusElement } from "./gamepad";
import { useBackGuard } from "./useBackGuard";

interface Props {
  games: InstalledGame[] | null;
  root: string;
  /** Open with this game's row focused (from the home screen). */
  focusId?: string | null;
  onClose: () => void;
  onUninstall: (game: InstalledGame) => Promise<boolean>;
}

/**
 * The games in the ROM library, by console, with Uninstall on each.
 *
 * Uninstalling deletes files, so it always asks first, in the row itself:
 * "Delete 3 files, 1.2 GB?" with Keep focused, so pressing A twice by accident
 * does nothing. Gamepad: one column; B closes (useBackGuard).
 */
const LibraryPanel: FC<Props> = ({ games, root, focusId, onClose, onUninstall }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useBackGuard(true, onClose);

  // Group by console, consoles with the most recent game first.
  const groups = useMemo(() => {
    const map = new Map<string, InstalledGame[]>();
    (games ?? []).forEach((game) => {
      const list = map.get(game.system) ?? [];
      list.push(game);
      map.set(game.system, list);
    });
    return Array.from(map.entries());
  }, [games]);

  const total = (games ?? []).reduce((sum, game) => sum + game.size, 0);

  // Start on the game that was picked on the home screen, else the first row.
  useEffect(() => {
    if (!games) return;
    window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = focusId ? panel?.querySelector(`[data-game="${focusId}"] .rs-lib-remove`) : null;
      focusElement(target ?? panel?.querySelector(".rs-lib-remove") ?? panel?.querySelector(".rs-lib-close"));
    });
  }, [games !== null]);

  const ask = (game: InstalledGame) => {
    setConfirming(game.id);
    // The safe answer has focus.
    window.requestAnimationFrame(() =>
      focusElement(panelRef.current?.querySelector(`[data-game="${game.id}"] .rs-lib-keep`)),
    );
  };

  const keep = (game: InstalledGame) => {
    setConfirming(null);
    window.requestAnimationFrame(() =>
      focusElement(panelRef.current?.querySelector(`[data-game="${game.id}"] .rs-lib-remove`)),
    );
  };

  const remove = async (game: InstalledGame) => {
    setBusy(game.id);
    // Focus moves to the next row before this one disappears.
    const rows = Array.from(panelRef.current?.querySelectorAll("[data-game]") ?? []);
    const next = rows[rows.findIndex((row) => row.getAttribute("data-game") === game.id) + 1] ?? rows[rows.length - 2];
    const ok = await onUninstall(game);
    setBusy(null);
    setConfirming(null);
    if (ok) window.requestAnimationFrame(() => focusElement(next?.querySelector(".rs-lib-remove") ?? panelRef.current?.querySelector(".rs-lib-close")));
  };

  return (
    <div className="rs-overlay" style={{ justifyContent: "flex-end", padding: 0 }} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <Focusable ref={panelRef} className="rs-panel drawer library" flow-children="column" onCancelActionDescription="Close">
        <div className="rs-panel-head">
          <div className="rs-lib-head">
            <h3>Installed games</h3>
            <span className="rs-lib-sub">
              {games ? `${games.length} ${games.length === 1 ? "game" : "games"} · ${formatBytes(total)}` : "Looking…"}
            </span>
          </div>
          <Button className="rs-btn ghost rs-lib-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="rs-panel-body">
          {games === null ? (
            <div className="rs-loading">
              <div className="rs-spinner" /> Reading the library…
            </div>
          ) : null}
          {games && games.length === 0 ? (
            <div className="rs-hint">
              No games in <span className="rs-path">{root}</span> yet. Downloads land there, sorted by console.
            </div>
          ) : null}
          {groups.map(([system, list]) => (
            <div key={system} className="rs-lib-group">
              <div className="rs-section-title">
                {systemLabel(system)} <span className="rs-lib-count">{list.length}</span>
              </div>
              {list.map((game) => {
                const asking = confirming === game.id;
                const files = game.files.length;
                return (
                  <div key={game.id} className={`rs-lib-row${asking ? " asking" : ""}`} data-game={game.id}>
                    <div className="rs-lib-main">
                      <div className="rs-lib-title" title={game.files.map((file) => file.name).join("\n")}>
                        {game.in_steam ? (
                          <span className="rs-lib-steam" title="In your Steam library">
                            <FaSteam />
                          </span>
                        ) : null}
                        {game.title}
                      </div>
                      <div className="rs-lib-meta">
                        {asking
                          ? `Delete ${files} ${files === 1 ? "file" : "files"}, ${formatBytes(game.size)}? This cannot be undone.`
                          : `${formatBytes(game.size)}${files > 1 ? ` · ${files} files` : ""}`}
                      </div>
                    </div>
                    {asking ? (
                      <Focusable className="rs-panel-actions" flow-children="row">
                        <Button className="rs-btn ghost rs-lib-keep" onClick={() => keep(game)} onOKActionDescription="Keep">
                          Keep
                        </Button>
                        <Button
                          className="rs-btn danger rs-lib-delete"
                          disabled={busy === game.id}
                          onClick={() => remove(game)}
                          onOKActionDescription="Delete"
                        >
                          <FaTrash /> {busy === game.id ? "Deleting…" : "Delete"}
                        </Button>
                      </Focusable>
                    ) : (
                      <Button className="rs-btn ghost rs-lib-remove" onClick={() => ask(game)} onOKActionDescription="Uninstall">
                        Uninstall
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Focusable>
    </div>
  );
};

export default LibraryPanel;
