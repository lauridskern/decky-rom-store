import { FC, useEffect, useRef, useState } from "react";
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
const CoverImage: FC<Props> = ({ url, kind = "card", alt = "", className, eager }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(!!eager);

  // Only pull images for cards that are actually on screen.
  useEffect(() => {
    if (eager || !url) {
      setVisible(true);
      return;
    }
    const node = holder.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, url]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!url) {
      setSrc(null);
      return;
    }
    if (!visible) {
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
  }, [url, kind, visible]);

  return (
    <div ref={holder} className={className} style={{ width: "100%", height: "100%" }}>
      {src && !failed ? (
        <img src={src} alt={alt} onError={() => setFailed(true)} />
      ) : null}
    </div>
  );
};

export default CoverImage;
