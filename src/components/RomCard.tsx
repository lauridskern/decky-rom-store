import { FC, memo, useReducer } from "react";
import { Focusable } from "@decky/ui";
import { FaGamepad } from "react-icons/fa";
import { MergedRom } from "../types";
import { artRatios, clampArtRatio, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  onOpen: (rom: MergedRom) => void;
}

/**
 * One shelf item: the cover art is the whole item, in the art's own shape, so
 * nothing is cropped and there are no bars around it. Until the art has loaded
 * the frame holds the console's usual box shape. Only the console is drawn
 * over the art (the title shows only when there is no art); everything else
 * lives in the game panel.
 *
 * The measured shape is remembered per cover url, so paging back, searching
 * again or reopening the store draws every frame at its final size at once.
 */
const RomCard: FC<Props> = memo(({ rom, onOpen }) => {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const known = rom.cover ? artRatios.get(rom.cover) : undefined;
  const shape = known ? String(clampArtRatio(known)) : systemAspect(rom.system);

  const onRatio = (ratio: number) => {
    if (rom.cover && artRatios.get(rom.cover) !== ratio) {
      artRatios.set(rom.cover, ratio);
      refresh();
    }
    return clampArtRatio(ratio) === ratio;
  };

  return (
    <Focusable
      className="rs-card"
      focusClassName="rs-card--focus"
      style={{ aspectRatio: shape }}
      onActivate={() => onOpen(rom)}
      onOKActionDescription="Details"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(rom);
        }
      }}
      onClick={() => onOpen(rom)}
    >
      <div className="rs-card-art" title={rom.title}>
        {rom.cover ? (
          <CoverImage url={rom.cover} alt={rom.title} onRatio={onRatio} />
        ) : (
          // Without art the title is the only way to tell the game apart.
          <div className="rs-cover-placeholder rs-card-noart">
            <FaGamepad />
            <span className="rs-card-noart-title">{rom.title}</span>
          </div>
        )}
        <span className="rs-chip">{systemLabel(rom.system)}</span>
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
