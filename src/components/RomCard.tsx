import { CSSProperties, FC, memo } from "react";
import { Focusable } from "@decky/ui";
import { FaGamepad } from "react-icons/fa";
import { MergedRom } from "../types";
import { formatCount, systemAspect, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  onOpen: (rom: MergedRom) => void;
  rowIndex?: number;
}

const RomCard: FC<Props> = memo(({ rom, onOpen, rowIndex }) => {
  const rating = rom.rating ? rom.rating.toFixed(1) : null;
  const downloads = formatCount(rom.downloads);

  return (
    <Focusable
      data-row={rowIndex}
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
      <div
        className="rs-cover"
        style={{
          aspectRatio: systemAspect(rom.system),
          ...(rom.cover ? ({ ["--rs-cover" as string]: `url(${rom.cover})` } as CSSProperties) : {}),
        }}
      >
        {rom.cover ? (
          <CoverImage url={rom.cover} alt={rom.title} />
        ) : (
          <div className="rs-placeholder">
            <FaGamepad />
          </div>
        )}
      </div>
      <div className="rs-card-body">
        <div className="rs-title" title={rom.title}>
          {rom.title}
        </div>
        <div className="rs-meta">
          <span className="rs-pill system">{systemLabel(rom.system)}</span>
          {rating && <span className="rs-pill rating">★ {rating}</span>}
          {downloads ? <span className="rs-pill">↓ {downloads}</span> : null}
        </div>
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
