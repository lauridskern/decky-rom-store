import { FC, memo } from "react";
import { Focusable } from "@decky/ui";
import { MergedRom } from "../types";
import { shelfKey } from "./common";
import { ENTER_KEEP_X } from "./gamepad";
import RomCard from "./RomCard";

interface Props {
  items: MergedRom[];
  /** Keys of the favourites (shelfKey), for the star on a cover. */
  favorites: Set<string>;
  onOpen: (rom: MergedRom) => void;
  /** The cover that has focus, for the title line under the grid. */
  onFocus: (rom: MergedRom) => void;
  onFavorite: (rom: MergedRom) => void;
}

/**
 * The result grid.
 *
 * This used to be a windowed list, but windowing a grid of images is the
 * opposite of fast on the Deck: every row that scrolled in mounted a batch of
 * fresh <img> elements, which meant the Steam client decoded the same covers
 * again and again, and the measured-row bookkeeping re-laid out the grid on
 * every scroll frame. Both kept the CPU (and the fan) busy.
 *
 * The store now shows one page of results at a time and renders it once. The
 * browser decodes each cover a single time and scrolling is only paint work.
 *
 * Gamepad: a "grid" focus group, so the d-pad moves by where the covers are on
 * screen (left/right along a row, up/down between rows). Coming down from the
 * filters it lands on the cover under the control that had focus.
 */
const RomGrid: FC<Props> = ({ items, favorites, onOpen, onFocus, onFavorite }) => (
  <Focusable className="rs-grid" flow-children="grid" navEntryPreferPosition={ENTER_KEEP_X}>
    {items.map((rom, slot) => (
      // Keyed by slot, not by game: paging then reuses the same 30 card
      // components (and the same Steam focus nodes) instead of destroying and
      // recreating all of them for every page.
      <RomCard
        key={slot}
        rom={rom}
        favorite={favorites.has(shelfKey(rom.system, rom.title))}
        onOpen={onOpen}
        onFocus={onFocus}
        onFavorite={onFavorite}
      />
    ))}
  </Focusable>
);

export default memo(RomGrid);
