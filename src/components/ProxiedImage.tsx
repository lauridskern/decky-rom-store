import { FC, useEffect, useState } from "react";
import { getCover } from "../types";

interface Props {
  url: string;
  alt?: string;
  className?: string;
}

/**
 * Loads an image through the plugin backend, which downloads it once and
 * serves it from the Deck. Remote hosts are often blocked by the Steam
 * client, so going through the backend is the only reliable way.
 */
const ProxiedImage: FC<Props> = ({ url, alt = "", className }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    if (!url) return;
    getCover(url, "card")
      .then((resolved) => {
        if (!cancelled) setSrc(resolved ?? null);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!src || failed) {
    return <div className={`rs-shot-empty ${className ?? ""}`} />;
  }
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
};

export default ProxiedImage;
