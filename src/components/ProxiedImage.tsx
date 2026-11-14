import { FC, useEffect, useState } from "react";
import { getCover } from "../types";

interface Props {
  url: string;
  alt?: string;
  className?: string;
  eager?: boolean;
}

/**
 * Loads an image through the plugin backend, which downloads it once and
 * serves it from the Deck. Remote hosts are often blocked by the Steam
 * client, so going through the backend is the only reliable way.
 */
const ProxiedImage: FC<Props> = ({ url, alt = "", className, eager }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    if (!url) return;
    const fallback = () => {
      // The local copy is the fast path; the remote url is the fallback.
      if (!cancelled) setSrc(url);
    };
    getCover(url, "card")
      .then((resolved) => {
        if (cancelled) return;
        if (resolved && resolved !== url) setSrc(resolved);
        else fallback();
      })
      .catch(() => {
        if (!cancelled) fallback();
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!src || failed) {
    return <div className={`rs-shot-empty ${className ?? ""}`} />;
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
};

export default ProxiedImage;
