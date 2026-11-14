import { FC, memo } from "react";
import { Focusable } from "@decky/ui";
import { FaGamepad } from "react-icons/fa";
import { MergedRom } from "../types";
import { formatBytes, formatCount, SOURCE_LABELS, systemLabel } from "./common";
import CoverImage from "./CoverImage";

interface Props {
  rom: MergedRom;
  onOpen: (rom: MergedRom) => void;
}

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
      <div className="rs-cover">
        {rom.cover ? (
          <CoverImage url={rom.cover} alt={rom.title} />
        ) : (
          <div className="rs-placeholder">
            <FaGamepad />
          </div>
        )}
        {rom.variants > 1 && <div className="rs-dup">{rom.variants}×</div>}
      </div>
      <div className="rs-card-body">
        <div className="rs-title" title={rom.title}>
          {rom.title}
        </div>
        <div className="rs-meta">
          <span className="rs-pill system">{systemLabel(rom.system)}</span>
          {rom.sources.map((source) => (
            <span key={source} className={`rs-pill ${source}`}>
              {SOURCE_LABELS[source] ?? source}
            </span>
          ))}
          {rom.regions.slice(0, 2).map((region) => (
            <span key={region} className="rs-pill region">
              {region}
            </span>
          ))}
          {rating && <span className="rs-pill rating">★ {rating}</span>}
          {rom.size ? <span className="rs-pill">{formatBytes(rom.size)}</span> : null}
          {downloads ? <span className="rs-pill">↓ {downloads}</span> : null}
        </div>
      </div>
    </Focusable>
  );
});

RomCard.displayName = "RomCard";

export default RomCard;
