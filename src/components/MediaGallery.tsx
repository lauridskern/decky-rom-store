import { FC, useEffect, useState } from "react";
import { FaExpand, FaPlay } from "react-icons/fa";
import { getCover } from "../types";
import ProxiedImage from "./ProxiedImage";

export interface MediaShot {
  kind: "image" | "video";
  thumb: string;
  full: string;
  watch?: string;
  name?: string;
}

export interface Media {
  appid?: number;
  caption?: string;
  shots?: MediaShot[];
  trailer?: MediaShot | null;
  capsule?: string;
  header?: string;
}

interface Props {
  media: Media | null | undefined;
}

/**
 * A shelf of artwork above the download list: the game's own art, its trailer
 * and a few screenshots. The thumbnails are small (the Steam capsules are
 * around 100 kB), the full size media is only fetched when it is opened.
 */
const MediaGallery: FC<Props> = ({ media }) => {
  const [lightbox, setLightbox] = useState<MediaShot | null>(null);
  const [full, setFull] = useState<string | null>(null);

  const open = async (shot: MediaShot) => {
    setLightbox(shot);
    setFull(null);
    if (shot.kind === "image") {
      try {
        const proxied = await getCover(shot.full, "detail");
        if (proxied) setFull(proxied);
      } catch {
        /* fall back to the remote url */
      }
    }
  };

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (!media) return null;
  const shots = media.shots ?? [];
  const trailer = media.trailer ?? null;
  if (!shots.length && !trailer && !media.capsule) return null;

  return (
    <>
      <div className="rs-gallery">
        {media.capsule ? (
          <button className="rs-shot" onClick={() => open({ kind: "image", thumb: media.capsule!, full: media.capsule! })}>
            <ProxiedImage url={media.capsule} alt={media.caption || "cover"} eager />
          </button>
        ) : null}

        {trailer ? (
          <button className="rs-shot rs-shot-video" onClick={() => open(trailer)}>
            <ProxiedImage url={trailer.thumb} alt={trailer.name || "Trailer"} eager />
            <span className="rs-play">
              <FaPlay />
            </span>
          </button>
        ) : null}

        {shots.slice(0, 5).map((shot, index) => (
          <button className="rs-shot" key={`${shot.thumb}-${index}`} onClick={() => open(shot)}>
            <ProxiedImage url={shot.thumb} alt={`Screenshot ${index + 1}`} eager />
          </button>
        ))}
      </div>

      {lightbox ? (
        <div className="rs-lightbox" onClick={() => setLightbox(null)}>
          <button className="rs-lightbox-close" onClick={() => setLightbox(null)}>
            ✕
          </button>
          {lightbox.kind === "video" ? (
            <div className="rs-lightbox-video" onClick={(event) => event.stopPropagation()}>
              <iframe
                src={lightbox.full}
                title={lightbox.name || "Trailer"}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
              {lightbox.watch ? (
                <a className="rs-lightbox-link" href={lightbox.watch} target="_blank" rel="noreferrer">
                  Watch on YouTube
                </a>
              ) : null}
            </div>
          ) : (
            <img className="rs-lightbox-image" src={full || lightbox.full} alt="Media" onClick={(event) => event.stopPropagation()} />
          )}
          <span className="rs-lightbox-hint">
            <FaExpand /> Click anywhere to close
          </span>
        </div>
      ) : null}
    </>
  );
};

export default MediaGallery;
