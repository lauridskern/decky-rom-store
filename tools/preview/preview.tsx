import { FC, ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import StoreHost from "../../src/components/StoreHost";
import { injectStyles } from "../../src/styles";

injectStyles();

/**
 * Under the dev server (`npm run dev`) the store is drawn inside a 1280 x 800
 * Steam Deck screen, with stand-ins for the bars Steam draws over the top and
 * bottom, and scaled to fit the window. The screen has a transform, so the
 * store's `position: fixed` resolves against it exactly as it does against the
 * Deck's viewport. Add `?full` to the URL to fill the window instead.
 *
 * The test scripts load index.html from file:// and never get the frame.
 */
const DECK_W = 1280;
const DECK_H = 800;
const deck = location.protocol.startsWith("http") && !new URLSearchParams(location.search).has("full");

interface Hint {
  button: string;
  label: string;
}

/** The Steam button bar: hints for whatever has focus (sent by mock-ui). */
const ButtonBar: FC = () => {
  const [hints, setHints] = useState<Hint[]>([
    { button: "B", label: "Back" },
    { button: "A", label: "Select" },
  ]);
  useEffect(() => {
    const onLegend = (event: Event) => setHints((event as CustomEvent<Hint[]>).detail);
    window.addEventListener("rs-legend", onLegend);
    return () => window.removeEventListener("rs-legend", onLegend);
  }, []);
  return (
    <div className="deck-bar bottom">
      {hints.map((hint) => (
        <span key={hint.button} className="deck-hint">
          <b className={hint.button.length > 1 ? "wide" : undefined}>{hint.button}</b> {hint.label}
        </span>
      ))}
    </div>
  );
};

const DeckFrame: FC<{ children: ReactNode }> = ({ children }) => {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 24) / DECK_W, (window.innerHeight - 24) / DECK_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="deck-stage">
      <div className="deck-box" style={{ width: DECK_W * scale, height: DECK_H * scale }}>
        <div className="deck-screen" style={{ transform: `scale(${scale})` }}>
          <div className="deck-bar top">
            <span>ROM Store</span>
            <span>12:41 · 87%</span>
          </div>
          {children}
          <ButtonBar />
        </div>
      </div>
      <div className="deck-caption">
        Steam Deck · 1280 × 800 · {Math.round(scale * 100)}% · arrows = d-pad · Enter = A · Esc = B · X · Y · Q/E = L1/R1 ·
        controllers work · ?full fills the window
      </div>
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  if (deck) document.documentElement.classList.add("deck");
  createRoot(container).render(
    deck ? (
      <DeckFrame>
        <StoreHost />
      </DeckFrame>
    ) : (
      <StoreHost />
    ),
  );
}
