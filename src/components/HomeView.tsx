import { CSSProperties, FC, memo, useReducer } from "react";
import { Focusable } from "@decky/ui";
import { FaArrowRight, FaSearch } from "react-icons/fa";
import { InstalledGame, ShelfItem } from "../types";
import { artRatios, boxRatio, clampArtRatio, formatBytes, isResizedArt, systemLabel, systemTint } from "./common";
import CoverImage, { useCoverSrc } from "./CoverImage";
import { NoArt } from "./RomCard";
import { Glyph } from "./ui";

type Item = Pick<ShelfItem, "title" | "system" | "cover">;

interface Props {
  consoles: { key: string; count: number }[];
  favorites: ShelfItem[];
  recent: ShelfItem[];
  installed: InstalledGame[];
  /** How many sources are switched on, for the welcome line. */
  sources: number;
  onConsole: (key: string) => void;
  onItem: (item: Item) => void;
  /** Open the Library tab, on one game if given. */
  onInstalled: (focusId?: string | null) => void;
  onFavorite: (item: Item) => void;
  onSearch: () => void;
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

/**
 * The top of the home screen. With a game to go back to it is that game, big;
 * on a first visit it says what the store is and starts a search.
 */
const Hero: FC<{
  item: ShelfItem | null;
  eyebrow: string;
  games: number;
  consoles: number;
  sources: number;
  onItem: Props["onItem"];
  onSearch: () => void;
}> = ({ item, eyebrow, games, consoles, sources, onItem, onSearch }) => {
  const backdrop = useCoverSrc(item?.cover);
  const open = () => (item ? onItem(item) : onSearch());
  return (
    <Focusable
      className={`rs-hero rs-f${item ? "" : " welcome"}`}
      focusClassName="is-focus"
      onActivate={open}
      onClick={open}
      onOKActionDescription={item ? "Open" : "Search"}
    >
      {item && backdrop ? (
        <div className="rs-hero-bg" style={{ backgroundImage: `url("${backdrop}")` } as CSSProperties} />
      ) : null}
      {item ? <Art item={item} height={168} className="rs-hero-art" /> : null}
      <div className="rs-hero-text">
        <span className="rs-eyebrow">{item ? eyebrow : "ROM Store"}</span>
        <span className="rs-hero-title">{item ? item.title : "Find your next game"}</span>
        <span className="rs-hero-sub">
          {item
            ? systemLabel(item.system)
            : games
              ? `${games.toLocaleString()} games across ${consoles} consoles${sources ? `, from ${sources} sources at once` : ""}.`
              : "Search every source at once, or pick a console below."}
        </span>
        <span className="rs-hero-cta">
          {item ? (
            <>
              View game <FaArrowRight />
            </>
          ) : (
            <>
              <FaSearch /> Search <Glyph round>X</Glyph>
            </>
          )}
        </span>
      </div>
    </Focusable>
  );
};

const ShelfTile: FC<{ item: ShelfItem; favorite: boolean; onItem: Props["onItem"]; onFavorite: Props["onFavorite"] }> = ({
  item,
  favorite,
  onItem,
  onFavorite,
}) => (
  <Focusable
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
    <Focusable className="rs-shelf" flow-children="row">
      {items.map((item) => (
        <ShelfTile key={item.key} item={item} favorite={favorites.has(item.key)} onItem={onItem} onFavorite={onFavorite} />
      ))}
    </Focusable>
  </section>
);

/**
 * What the store shows before a search: the game you looked at last, your
 * shelves and every console to browse. With a gamepad this is the fast way in;
 * typing is the slow one.
 *
 * Gamepad: each shelf is a row, the consoles a grid; A opens, Y favourites.
 */
const HomeView: FC<Props> = ({ consoles, favorites, recent, installed, sources, onConsole, onItem, onInstalled, onFavorite, onSearch }) => {
  const hero = recent[0] ?? favorites[0] ?? null;
  const fromRecent = Boolean(recent[0]);
  const later = fromRecent ? recent.slice(1, 15) : [];
  const favoriteKeys = new Set(favorites.map((item) => item.key));
  const games = consoles.reduce((sum, item) => sum + item.count, 0);
  const size = installed.reduce((sum, game) => sum + game.size, 0);

  return (
    <div className="rs-home">
      <Hero
        item={hero}
        eyebrow={fromRecent ? "Jump back in" : "From your favourites"}
        games={games}
        consoles={consoles.length}
        sources={sources}
        onItem={onItem}
        onSearch={onSearch}
      />

      {later.length ? (
        <Shelf title="Recently viewed" items={later} favorites={favoriteKeys} onItem={onItem} onFavorite={onFavorite} />
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
          <Focusable className="rs-shelf" flow-children="row">
            {installed.slice(0, 12).map((game) => (
              <Focusable
                key={game.id}
                className="rs-shelf-tile"
                focusClassName="is-focus"
                onActivate={() => onInstalled(game.id)}
                onClick={() => onInstalled(game.id)}
                onOKActionDescription="Show in library"
              >
                <Art item={{ title: game.title, system: game.system, cover: game.cover ?? null }} height={172} className="rs-shelf-art" />
                <div className="rs-shelf-title" title={game.title}>
                  {game.title}
                </div>
                <div className="rs-shelf-sub">
                  {systemLabel(game.system)} · {formatBytes(game.size)}
                </div>
              </Focusable>
            ))}
            <Focusable
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
          <Focusable className="rs-consoles" flow-children="grid">
            {consoles.map((item) => (
              <Focusable
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
