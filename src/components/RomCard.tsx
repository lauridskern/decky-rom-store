import { FC, memo } from "react";
import { Focusable } from "@decky/ui";
import { FaGamepad } from "react-icons/fa";
import { MergedRom } from "../types";
import { formatCount, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  onOpen: (rom: MergedRom) => void;
}

/**
 * One shelf item: the poster, the title and three facts. The frame is a
 * poster for every console (that is the shape box art is published in) and
 * the artwork is fitted rather than cropped, so the grid stays even and no
 * cover loses its edges.
 */
const RomCard: FC<Props> = memo(({ rom, onOpen }) => {
  const rating = rom.rating ? rom.rating.toFixed(1) : null;
  const downloads = formatCount(rom.downloads);

  return (
    <Focusable
      className="rs-card"
      focusClassName="rs-card--focus"
      onActivate={() => onOpen(rom)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(rom);
        }
      }}
      onClick={() => onOpen(rom)}
    >
      <div className="rs-card-art">
        {rom.cover ? (
          <CoverImage url={rom.cover} alt={rom.title} />
        ) : (
          <div className="rs-cover-placeholder">
            <FaGamepad />
          </div>
        )}
        {/* The console sits on the artwork: in a narrow card it would be
            truncated next to the rating and download count. */}
        <span className="rs-chip">{systemLabel(rom.system)}</span>
      </div>
      <div className="rs-card-body">
        <div className="rs-title" title={rom.title}>
          {rom.title}
        </div>
        <div className="rs-card-meta">
          <span className="rs-card-stats">
            {rating ? <span className="rs-stat rating">★ {rating}</span> : null}
            {downloads ? <span className="rs-stat">↓ {downloads}</span> : null}
          </span>
        </div>
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
