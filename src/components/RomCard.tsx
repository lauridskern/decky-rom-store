import { FC, memo, useReducer } from "react";
import { Focusable } from "@decky/ui";
import { FaCheck, FaGamepad } from "react-icons/fa";
import { MergedRom } from "../types";
import { artRatios, clampArtRatio, isResizedArt, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  onOpen: (rom: MergedRom) => void;
}

/**
 * One shelf item: the cover art is the whole item, nothing cropped, no bars.
 *
 * Its shape: art that its source resized to a fixed size (Romspedia) gets the
 * console's real box shape and is stretched back into it; any other art keeps
 * its own shape, measured once it has loaded. Until then, and without art, the
 * frame has the console's box shape. Only the console is drawn
 * over the art (the title shows only when there is no art); everything else
 * lives in the game panel.
 *
 * The measured shape is remembered per cover url, so paging back, searching
 * again or reopening the store draws every frame at its final size at once.
 */
const RomCard: FC<Props> = memo(({ rom, onOpen }) => {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const resized = isResizedArt(rom.cover);
  const known = rom.cover && !resized ? artRatios.get(rom.cover) : undefined;
  const shape = known ? String(clampArtRatio(known)) : systemAspect(rom.system);

  const onRatio = (ratio: number) => {
    if (rom.cover) artRatios.set(rom.cover, ratio);
    // Re-render whenever this card's frame is not the art's shape yet - also
    // when another card with the same cover already measured it, or this one
    // keeps the box shape while the art is told to fill it (and gets cropped).
    if (known !== ratio) refresh();
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
          <CoverImage url={rom.cover} alt={rom.title} stretch={resized} onRatio={resized ? undefined : onRatio} />
        ) : (
          // Without art the title is the only way to tell the game apart.
          <div className="rs-cover-placeholder rs-card-noart">
            <FaGamepad />
            <span className="rs-card-noart-title">{rom.title}</span>
          </div>
        )}
        <span className="rs-chip">{systemLabel(rom.system)}</span>
        {rom.installed ? (
          <span className="rs-owned" title="In your library">
            <FaCheck />
          </span>
        ) : null}
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
