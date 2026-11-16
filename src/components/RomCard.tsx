import { CSSProperties, FC, memo, useReducer, useState } from "react";
import { Focusable } from "@decky/ui";
import { FaCheck, FaStar } from "react-icons/fa";
import { MergedRom } from "../types";
import { artRatios, clampArtRatio, isResizedArt, systemAspect, systemLabel, systemTint } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  favorite: boolean;
  onOpen: (rom: MergedRom) => void;
  onFocus: (rom: MergedRom) => void;
  onFavorite: (rom: MergedRom) => void;
}

/**
 * A cover without art: the title on the console's colour, so the game can
 * still be told apart at a glance.
 */
export const NoArt: FC<{ title: string; system: string }> = ({ title, system }) => (
  <div className="rs-noart" style={{ "--rs-tint": systemTint(system) } as CSSProperties}>
    <span className="rs-noart-title">{title}</span>
    <span className="rs-noart-system">{systemLabel(system)}</span>
  </div>
);

/**
 * One game in the grid: the cover art is the whole item, nothing cropped, no
 * bars, no text. Its title shows in the line under the grid while it has
 * focus (and on the cover itself only when there is no art).
 *
 * Its shape: art that its source resized to a fixed size (Romspedia) gets the
 * console's real box shape and is stretched back into it; any other art keeps
 * its own shape, measured once it has loaded. Until then, and without art, the
 * frame has the console's box shape.
 *
 * The measured shape is remembered per cover url, so paging back, searching
 * again or reopening the store draws every frame at its final size at once.
 *
 * Gamepad: A opens the game, Y adds it to (or takes it off) the favourites.
 */
const RomCard: FC<Props> = memo(({ rom, favorite, onOpen, onFocus, onFavorite }) => {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  // The cover url that failed to load: the card shows the title tile instead.
  const [broken, setBroken] = useState<string | null>(null);
  const art = rom.cover && rom.cover !== broken ? rom.cover : null;
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

  const focus = () => onFocus(rom);

  return (
    <Focusable noFocusRing
      className="rs-card"
      focusClassName="rs-card--focus"
      style={{ aspectRatio: shape }}
      onActivate={() => onOpen(rom)}
      onOKActionDescription="Open"
      onOptionsButton={() => onFavorite(rom)}
      onOptionsActionDescription={favorite ? "Unfavourite" : "Favourite"}
      onGamepadFocus={focus}
      onFocus={focus}
      onMouseEnter={focus}
      onClick={() => onOpen(rom)}
    >
      <div className="rs-card-art" title={rom.title}>
        {art ? (
          <CoverImage url={art} alt={rom.title} stretch={resized} onRatio={resized ? undefined : onRatio}
            onFail={() => setBroken(art)} />
        ) : (
          <NoArt title={rom.title} system={rom.system} />
        )}
        {art ? <span className="rs-chip">{systemLabel(rom.system)}</span> : null}
        {rom.installed || favorite ? (
          <span className="rs-marks">
            {favorite ? (
              <span className="rs-mark fav" title="Favourite">
                <FaStar />
              </span>
            ) : null}
            {rom.installed ? (
              <span className="rs-mark owned" title="In your library">
                <FaCheck />
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
