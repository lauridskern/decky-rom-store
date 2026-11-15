import { FC, memo, useReducer } from "react";
import { Focusable } from "@decky/ui";
import { FaCheck, FaGamepad, FaHdd } from "react-icons/fa";
import { DownloadJob, InstalledGame, ShelfItem } from "../types";
import { artRatios, boxRatio, clampArtRatio, formatBytes, isResizedArt, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  consoles: { key: string; count: number }[];
  favorites: ShelfItem[];
  recent: ShelfItem[];
  downloads: DownloadJob[];
  installed: InstalledGame[];
  onConsole: (key: string) => void;
  onItem: (item: Pick<ShelfItem, "title" | "system">) => void;
  /** Open the Installed games panel, on one game if given. */
  onInstalled: (focusId?: string | null) => void;
}

/**
 * One game on a shelf, title below. Same shape rule as the grid (RomCard):
 * resized Romspedia art gets the console's box shape, other art its own.
 */
const ShelfTile: FC<{ item: ShelfItem; onItem: Props["onItem"] }> = ({ item, onItem }) => {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const resized = isResizedArt(item.cover);
  const known = item.cover && !resized ? artRatios.get(item.cover) : undefined;
  const ratio = Math.min(1.45, Math.max(0.55, known ? clampArtRatio(known) : boxRatio(item.system)));
  const onRatio = (value: number) => {
    if (item.cover) artRatios.set(item.cover, value);
    // Same rule as RomCard: re-render unless this tile already has the shape,
    // even when another tile with the same cover measured it first.
    if (known !== value) refresh();
    return clampArtRatio(value) === value && value >= 0.55 && value <= 1.45;
  };
  return (
    <Focusable
      className="rs-shelf-tile"
      focusClassName="is-focus"
      style={{ width: Math.round(150 * ratio) }}
      onActivate={() => onItem(item)}
      onClick={() => onItem(item)}
      onOKActionDescription="Open"
    >
      <div className="rs-shelf-art" style={{ aspectRatio: String(ratio) }}>
        {item.cover ? (
          <CoverImage url={item.cover} alt={item.title} stretch={resized} onRatio={resized ? undefined : onRatio} />
        ) : (
          <div className="rs-cover-placeholder">
            <FaGamepad />
          </div>
        )}
      </div>
      <div className="rs-shelf-title" title={item.title}>
        {item.title}
      </div>
      <div className="rs-shelf-sub">{systemLabel(item.system)}</div>
    </Focusable>
  );
};

const Shelf: FC<{ title: string; items: ShelfItem[]; onItem: Props["onItem"] }> = ({ title, items, onItem }) => (
  <section className="rs-home-section">
    <h3 className="rs-home-head">{title}</h3>
    <Focusable className="rs-shelf" flow-children="row">
      {items.map((item) => (
        <ShelfTile key={item.key} item={item} onItem={onItem} />
      ))}
    </Focusable>
  </section>
);

/**
 * What the store shows before a search: where you left off, your favourites,
 * what you downloaded lately and every console to browse. With a gamepad this
 * is the fast way in; typing is the slow one.
 *
 * Gamepad: each shelf is a row, the consoles a grid; A opens.
 */
const HomeView: FC<Props> = ({ consoles, favorites, recent, downloads, installed, onConsole, onItem, onInstalled }) => (
  <div className="rs-home">
    {recent.length ? <Shelf title="Recently viewed" items={recent.slice(0, 14)} onItem={onItem} /> : null}
    {favorites.length ? <Shelf title="Favourites" items={favorites.slice(0, 30)} onItem={onItem} /> : null}

    {downloads.length ? (
      <section className="rs-home-section">
        <h3 className="rs-home-head">Recent downloads</h3>
        <Focusable className="rs-shelf rs-shelf-text" flow-children="row">
          {downloads.slice(0, 10).map((job) => (
            <Focusable
              key={job.id}
              className="rs-download-tile"
              focusClassName="is-focus"
              onActivate={() => onItem({ title: job.title, system: job.system })}
              onClick={() => onItem({ title: job.title, system: job.system })}
              onOKActionDescription="Open"
            >
              <span className="rs-download-tile-check">
                <FaCheck />
              </span>
              <span className="rs-download-tile-title" title={job.title}>
                {job.title}
              </span>
              <span className="rs-shelf-sub">{systemLabel(job.system)}</span>
            </Focusable>
          ))}
        </Focusable>
      </section>
    ) : null}

    {installed.length ? (
      <section className="rs-home-section">
        <h3 className="rs-home-head">Installed</h3>
        <Focusable className="rs-shelf rs-shelf-text" flow-children="row">
          <Focusable
            className="rs-download-tile rs-manage-tile"
            focusClassName="is-focus"
            onActivate={() => onInstalled(null)}
            onClick={() => onInstalled(null)}
            onOKActionDescription="Manage"
          >
            <span className="rs-download-tile-check manage">
              <FaHdd />
            </span>
            <span className="rs-download-tile-title">Manage all</span>
            <span className="rs-shelf-sub">
              {installed.length} {installed.length === 1 ? "game" : "games"} ·{" "}
              {formatBytes(installed.reduce((sum, game) => sum + game.size, 0))}
            </span>
          </Focusable>
          {installed.slice(0, 12).map((game) => (
            <Focusable
              key={game.id}
              className="rs-download-tile"
              focusClassName="is-focus"
              onActivate={() => onInstalled(game.id)}
              onClick={() => onInstalled(game.id)}
              onOKActionDescription="Manage"
            >
              <span className="rs-download-tile-check">
                <FaCheck />
              </span>
              <span className="rs-download-tile-title" title={game.title}>
                {game.title}
              </span>
              <span className="rs-shelf-sub">
                {systemLabel(game.system)} · {formatBytes(game.size)}
              </span>
            </Focusable>
          ))}
        </Focusable>
      </section>
    ) : null}

    <section className="rs-home-section">
      <h3 className="rs-home-head">Browse a console</h3>
      <Focusable className="rs-browse-grid" flow-children="grid">
        {consoles.map((item) => (
          <Focusable
            key={item.key}
            className="rs-browse-tile"
            focusClassName="is-focus"
            onActivate={() => onConsole(item.key)}
            onClick={() => onConsole(item.key)}
            onOKActionDescription="Browse"
          >
            <span className="rs-browse-name">{systemLabel(item.key)}</span>
            {item.count ? <span className="rs-browse-count">{item.count.toLocaleString()}</span> : null}
          </Focusable>
        ))}
      </Focusable>
    </section>
  </div>
);

export default memo(HomeView);
