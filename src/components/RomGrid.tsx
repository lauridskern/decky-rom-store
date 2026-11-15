import { FC, memo } from "react";
import { MergedRom } from "../types";
import RomCard from "./RomCard";

interface Props {
  items: MergedRom[];
  onOpen: (rom: MergedRom) => void;
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
 */
const RomGrid: FC<Props> = ({ items, onOpen }) => (
  <div className="rs-grid">
    {items.map((rom) => (
      <RomCard key={rom.id} rom={rom} onOpen={onOpen} />
    ))}
  </div>
);

export default memo(RomGrid);
