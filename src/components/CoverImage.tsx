import { FC, useEffect, useState } from "react";
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
 */
const CoverImage: FC<Props> = ({ url, kind = "card", alt = "", className }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
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

  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      {src && !failed ? (
        <img src={src} alt={alt} decoding="async" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="rs-cover-placeholder">
          <FaGamepad />
        </div>
      )}
    </div>
  );
};

export default CoverImage;
