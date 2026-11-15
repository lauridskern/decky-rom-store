import { FC, SyntheticEvent, useEffect, useRef, useState } from "react";
import { FaGamepad } from "react-icons/fa";
import { getCover } from "../types";

// Resolved cover urls are cached for the session: remounting a card (for
// example after a search) must not ask the backend again.
const coverCache = new Map<string, string>();

interface Props {
  url: string | null;
  kind?: "card" | "detail";
  alt?: string;
  className?: string;
  eager?: boolean;
}

/**
 * Cover art is fetched by the backend and cached on the Deck, so the Steam
 * client only ever loads a local, already downloaded file.
 *
 * The artwork is never cropped: when the art does not have the shape of its
 * frame (a square DS box in a poster frame, a landscape screenshot) it is
 * fitted inside and the frame is filled with its own colours instead of
 * cutting the picture off at the edges.
 */
const CoverImage: FC<Props> = ({ url, kind = "card", alt = "", className }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const frame = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    // The fit is deliberately not reset here: a card that is reused for the
    // next page may resolve to the very same cached file, and an unchanged
    // src never fires onLoad again - resetting would leave it cropped.
    if (!url) {
      setSrc(null);
      return;
    }
    const cacheKey = `${kind}:${url}`;
    const cached = coverCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }
    getCover(url, kind)
      .then((resolved) => {
        if (cancelled) return;
        const value = resolved ?? url;
        coverCache.set(cacheKey, value);
        setSrc(value);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, kind]);

  // Only after the image has decoded can we tell whether it fits the frame.
  const measure = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const box = frame.current;
    if (!box || !image.naturalWidth || !image.naturalHeight) return;
    const boxRatio = box.clientWidth / Math.max(box.clientHeight, 1);
    if (!boxRatio) return;
    const artRatio = image.naturalWidth / image.naturalHeight;
    const offset = artRatio / boxRatio;
    // Only a genuinely matching shape is allowed to crop. Console boxes are
    // all "roughly portrait" but differ by a few percent, and a few percent is
    // enough to shave the title off the top of the cover - so anything that is
    // not within 4% of the frame is fitted instead of filled.
    setFit(offset > 1.04 || offset < 0.96 ? "contain" : "cover");
  };

  return (
    <div ref={frame} className={`rs-cover-img rs-cover-img--${fit} ${className ?? ""}`}>
      {src && !failed ? (
        <>
          {fit === "contain" ? (
            <div className="rs-cover-ambient" style={{ backgroundImage: `url("${src}")` }} />
          ) : null}
          <img src={src} alt={alt} decoding="async" loading="lazy" onLoad={measure} onError={() => setFailed(true)} />
        </>
      ) : (
        <div className="rs-cover-placeholder">
          <FaGamepad />
        </div>
      )}
    </div>
  );
};

export default CoverImage;
