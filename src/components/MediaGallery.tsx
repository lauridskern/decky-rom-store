import { FC, useEffect, useRef, useState } from "react";
import { Focusable, GamepadEvent } from "@decky/ui";
import { FaPlay } from "react-icons/fa";
import { getCover } from "../types";
import ProxiedImage from "./ProxiedImage";
import { focusElement, PAD, stopNav } from "./gamepad";
import { useBackGuard } from "./useBackGuard";

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
 * A shelf of artwork in the game panel: the trailer and a few screenshots. The
 * thumbnails are small (the Steam capsules are around 100 kB), the full size
 * media is only fetched when it is opened.
 *
 * Gamepad: the strip is a row (left/right), A opens an item full screen. In
 * there left/right step through the items, A goes to the next one and B closes
 * it without closing the game panel behind it.
 */
const MediaGallery: FC<Props> = ({ media }) => {
  const [index, setIndex] = useState<number | null>(null);
  const [full, setFull] = useState<string | null>(null);
  // The thumbnail (already on the Deck) stands in until the full image is
  // there, and stays if the full image cannot be loaded.
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<Element | null>(null);

  const shots = media?.shots ?? [];
  const trailer = media?.trailer ?? null;
  // The capsule is the game's portrait cover, which is already on screen in
  // the detail panel; cropped into a 16:9 thumbnail it only looks wrong.
  const items: MediaShot[] = [...(trailer ? [trailer] : []), ...shots.slice(0, 5)];
  const current = index !== null ? items[index] : null;

  const close = () => {
    setIndex(null);
    const back = opener.current;
    opener.current = null;
    window.requestAnimationFrame(() => focusElement(back));
  };

  // The back button closes the viewer, not the game panel behind it.
  useBackGuard(index !== null, close);

  const open = (at: number) => {
    opener.current = document.activeElement;
    setIndex(at);
  };

  const step = (delta: number) => {
    if (index === null || items.length < 2) return;
    setIndex((index + delta + items.length) % items.length);
  };

  // Resolve the full size image through the image cache. Only local files
  // are shown: a remote URL is often blocked by the Steam client.
  useEffect(() => {
    setFull(null);
    setPreview(null);
    setFailed(false);
    if (!current || current.kind !== "image") return;
    let cancelled = false;
    getCover(current.thumb, "card")
      .then((local) => {
        if (!cancelled && local) setPreview(local);
      })
      .catch(() => undefined);
    getCover(current.full, "detail")
      .then((local) => {
        if (cancelled) return;
        if (local) setFull(local);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.full]);

  // The viewer takes focus so the d-pad drives it, not the panel behind.
  useEffect(() => {
    if (index !== null) window.requestAnimationFrame(() => focusElement(boxRef.current));
  }, [index !== null]);

  // Keyboard and mouse: Escape closes, arrows step (Steam sends the d-pad as
  // gamepad events, handled on the viewer itself).
  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  if (!items.length) return null;

  const onDirection = (event: GamepadEvent) => {
    if (event.detail.button === PAD.DIR_LEFT) step(-1);
    else if (event.detail.button === PAD.DIR_RIGHT) step(1);
    // Up and down are swallowed too: focus stays in the viewer until B.
    stopNav(event);
  };

  return (
    <>
      <Focusable noFocusRing className="rs-gallery" flow-children="row">
        {items.map((item, at) => (
          <Focusable noFocusRing
            key={`${item.thumb}-${at}`}
            className={`rs-shot${item.kind === "video" ? " rs-shot-video" : ""}`}
            focusClassName="is-focus"
            onActivate={() => open(at)}
            onClick={() => open(at)}
            onOKActionDescription={item.kind === "video" ? "Play trailer" : "View"}
          >
            <ProxiedImage url={item.thumb} alt={item.name || (item.kind === "video" ? "Trailer" : `Screenshot ${at + 1}`)} eager />
            {item.kind === "video" ? (
              <span className="rs-play">
                <FaPlay />
              </span>
            ) : null}
          </Focusable>
        ))}
      </Focusable>

      {current ? (
        <Focusable
          ref={boxRef}
          className="rs-lightbox"
          noFocusRing
          onActivate={() => step(1)}
          onOKActionDescription={items.length > 1 ? "Next" : undefined}
          onCancelActionDescription="Close"
          onGamepadDirection={onDirection}
          onClick={(event) => event.target === event.currentTarget && close()}
        >
          <button className="rs-lightbox-close" onClick={close} tabIndex={-1} aria-label="Close">
            ✕
          </button>
          {current.kind === "video" ? (
            <div className="rs-lightbox-video">
              <iframe
                src={current.full}
                title={current.name || "Trailer"}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
              {current.watch ? (
                <a className="rs-lightbox-link" href={current.watch} target="_blank" rel="noreferrer">
                  Watch on YouTube
                </a>
              ) : null}
            </div>
          ) : (
            <div className="rs-lightbox-frame">
              {full && !failed ? (
                <img className="rs-lightbox-image" src={full} alt="Screenshot" onError={() => setFailed(true)} />
              ) : preview ? (
                <img className="rs-lightbox-image" src={preview} alt="Screenshot" />
              ) : failed ? (
                <div className="rs-lightbox-note">This image could not be loaded.</div>
              ) : (
                <div className="rs-lightbox-note">
                  <div className="rs-spinner" />
                </div>
              )}
            </div>
          )}
          <div className="rs-lightbox-bar">
            {items.length > 1 ? (
              <span className="rs-lightbox-count">
                {index! + 1} / {items.length}
              </span>
            ) : null}
            <span className="rs-lightbox-hint">
              {items.length > 1 ? "◀ ▶ browse · " : ""}B close
            </span>
          </div>
        </Focusable>
      ) : null}
    </>
  );
};

export default MediaGallery;
