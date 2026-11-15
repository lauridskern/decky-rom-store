import { CSSProperties, FC, memo, useReducer } from "react";
import { Focusable } from "@decky/ui";
import { FaArrowRight } from "react-icons/fa";
import { InstalledGame, ShelfItem } from "../types";
import { artRatios, boxRatio, clampArtRatio, formatBytes, isResizedArt, systemLabel, systemTint } from "./common";
import CoverImage from "./CoverImage";
import { NoArt } from "./RomCard";

type Item = Pick<ShelfItem, "title" | "system" | "cover">;

interface Props {
  /** Every console a source can browse, the popular ones first. */
  consoles: { key: string; count: number | null }[];
  favorites: ShelfItem[];
  recent: ShelfItem[];
  installed: InstalledGame[];
  onConsole: (key: string) => void;
  onItem: (item: Item) => void;
  /** Open the Library tab, on one game if given. */
  onInstalled: (focusId?: string | null) => void;
  onFavorite: (item: Item) => void;
}

/**
 * The shape of a frame that takes its art's own shape, like the grid covers
 * (RomCard): resized Romspedia art gets the console's box shape, other art
 * its own once it has loaded, kept inside a range a shelf can hold.
 */
function useArtShape(cover: string | null | undefined, system: string, min = 0.55, max = 1.45) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const resized = isResizedArt(cover);
  const known = cover && !resized ? artRatios.get(cover) : undefined;
  const ratio = Math.min(max, Math.max(min, known ? clampArtRatio(known) : boxRatio(system)));
  const onRatio = (value: number) => {
    if (cover) artRatios.set(cover, value);
    // Re-render unless this frame already has the shape, even when another
    // frame with the same cover measured it first.
    if (known !== value) refresh();
    return clampArtRatio(value) === value && value >= min && value <= max;
  };
  return { ratio, resized, onRatio: resized ? undefined : onRatio };
}

const Art: FC<{ item: Item; height: number; className: string }> = ({ item, height, className }) => {
  const { ratio, resized, onRatio } = useArtShape(item.cover, item.system);
  return (
    <div className={className} style={{ height, width: Math.round(height * ratio) }}>
      {item.cover ? (
        <CoverImage url={item.cover} alt={item.title} stretch={resized} onRatio={onRatio} />
      ) : (
        <NoArt title={item.title} system={item.system} />
      )}
    </div>
  );
};

const ShelfTile: FC<{ item: ShelfItem; favorite: boolean; onItem: Props["onItem"]; onFavorite: Props["onFavorite"] }> = ({
  item,
  favorite,
  onItem,
  onFavorite,
}) => (
  <Focusable noFocusRing
    className="rs-shelf-tile"
    focusClassName="is-focus"
    onActivate={() => onItem(item)}
    onClick={() => onItem(item)}
    onOKActionDescription="Open"
    onOptionsButton={() => onFavorite(item)}
    onOptionsActionDescription={favorite ? "Unfavourite" : "Favourite"}
  >
    <Art item={item} height={172} className="rs-shelf-art" />
    <div className="rs-shelf-title" title={item.title}>
      {item.title}
    </div>
    <div className="rs-shelf-sub">{systemLabel(item.system)}</div>
  </Focusable>
);

const Shelf: FC<{
  title: string;
  items: ShelfItem[];
  favorites: Set<string>;
  onItem: Props["onItem"];
  onFavorite: Props["onFavorite"];
}> = ({ title, items, favorites, onItem, onFavorite }) => (
  <section className="rs-section">
    <div className="rs-section-head">
      <h2 className="rs-h2">{title}</h2>
      <span className="rs-count">{items.length}</span>
    </div>
    <Focusable noFocusRing className="rs-shelf" flow-children="row">
      {items.map((item) => (
        <ShelfTile key={item.key} item={item} favorite={favorites.has(item.key)} onItem={onItem} onFavorite={onFavorite} />
      ))}
    </Focusable>
  </section>
);

/**
 * What the store shows before a search: your shelves and every console to
 * browse. With a gamepad this is the fast way in; typing is the slow one.
 *
 * Gamepad: each shelf is a row, the consoles a grid; A opens, Y favourites.
 */
const HomeView: FC<Props> = ({ consoles, favorites, recent, installed, onConsole, onItem, onInstalled, onFavorite }) => {
  const favoriteKeys = new Set(favorites.map((item) => item.key));
  const size = installed.reduce((sum, game) => sum + game.size, 0);

  return (
    <div className="rs-home">
      {recent.length ? (
        <Shelf title="Recently viewed" items={recent.slice(0, 15)} favorites={favoriteKeys} onItem={onItem} onFavorite={onFavorite} />
      ) : null}
      {favorites.length ? (
        <Shelf title="Favourites" items={favorites.slice(0, 30)} favorites={favoriteKeys} onItem={onItem} onFavorite={onFavorite} />
      ) : null}

      {installed.length ? (
        <section className="rs-section">
          <div className="rs-section-head">
            <h2 className="rs-h2">In your library</h2>
            <span className="rs-count">
              {installed.length} {installed.length === 1 ? "game" : "games"} · {formatBytes(size)}
            </span>
          </div>
          <Focusable noFocusRing className="rs-shelf" flow-children="row">
            {installed.slice(0, 12).map((game) => (
              <Focusable noFocusRing
                key={game.id}
                className="rs-shelf-tile"
                focusClassName="is-focus"
                onActivate={() => onInstalled(game.id)}
                onClick={() => onInstalled(game.id)}
                onOKActionDescription="Show in library"
              >
                <Art item={{ title: game.name ?? game.title, system: game.system, cover: game.cover ?? null }} height={172} className="rs-shelf-art" />
                <div className="rs-shelf-title" title={game.title}>
                  {game.name ?? game.title}
                </div>
                <div className="rs-shelf-sub">
                  {systemLabel(game.system)} · {formatBytes(game.size)}
                </div>
              </Focusable>
            ))}
            <Focusable noFocusRing
              className="rs-shelf-more rs-f"
              focusClassName="is-focus"
              onActivate={() => onInstalled(null)}
              onClick={() => onInstalled(null)}
              onOKActionDescription="Open library"
            >
              <FaArrowRight />
              <span>Library</span>
            </Focusable>
          </Focusable>
        </section>
      ) : null}

      {consoles.length ? (
        <section className="rs-section">
          <div className="rs-section-head">
            <h2 className="rs-h2">Browse by console</h2>
            <span className="rs-count">{consoles.length}</span>
          </div>
          <Focusable noFocusRing className="rs-consoles" flow-children="grid">
            {consoles.map((item) => (
              <Focusable noFocusRing
                key={item.key}
                className="rs-console rs-f"
                data-key={item.key}
                focusClassName="is-focus"
                style={{ "--rs-tint": systemTint(item.key) } as CSSProperties}
                onActivate={() => onConsole(item.key)}
                onClick={() => onConsole(item.key)}
                onOKActionDescription="Browse"
              >
                <span className="rs-console-name">{systemLabel(item.key)}</span>
                {item.count ? <span className="rs-console-count">{item.count.toLocaleString()} games</span> : null}
              </Focusable>
            ))}
          </Focusable>
        </section>
      ) : null}
    </div>
  );
};

export default memo(HomeView);
