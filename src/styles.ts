/**
 * Styles for the ROM Store, injected at runtime (Decky does not load CSS files).
 *
 * Built for the Steam Deck's 1280 x 800 screen held at arm's length: nothing
 * is smaller than 12px, anything that takes focus is at least 38px tall, and
 * focus is always the same thing - a white ring. Blue means "selected" or
 * "the main action", never focus.
 *
 * Rules that are not style preferences (AGENTS.md §10): no transforms, filters
 * or blurred shadows on anything that repeats in a list (covers, tiles, rows),
 * no content-visibility, and nothing that animates while the store is idle.
 */
export const CSS = `
.rs-store {
  --rs-bg: #0b0e13;
  --rs-panel: #131821;
  --rs-surface: rgba(255, 255, 255, 0.055);
  --rs-surface-2: rgba(255, 255, 255, 0.1);
  --rs-line: rgba(255, 255, 255, 0.08);
  --rs-text: #f1f3f6;
  --rs-text-2: #aab3be;
  --rs-text-3: #747e8b;
  --rs-accent: #3d9bff;
  --rs-accent-2: #6f6bff;
  --rs-good: #6ad37a;
  --rs-warn: #f3bd55;
  --rs-bad: #ff7d6b;
  --rs-gold: #f6c343;
  --rs-focus: #ffffff;
  --rs-pad: 32px;

  /* The Steam client draws a header bar over the top of the window and a
     button bar over the bottom. The store lives between them. */
  position: fixed;
  top: var(--rs-chrome-top, var(--basicui-header-height, 40px));
  bottom: var(--rs-chrome-bottom, 40px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    radial-gradient(1100px 520px at 8% -12%, rgba(61, 155, 255, 0.13), rgba(61, 155, 255, 0) 62%),
    radial-gradient(900px 460px at 104% -6%, rgba(111, 107, 255, 0.11), rgba(111, 107, 255, 0) 58%),
    var(--rs-bg);
  color: var(--rs-text);
  font-family: "Motiva Sans", "Noto Sans", sans-serif;
  font-size: 14px;
  line-height: 1.35;
  user-select: none;
}
.rs-store [class^="rs-"], .rs-store [class*=" rs-"] { box-sizing: border-box; }

/* ------------------------------------------------------------------ focus */
/* Everything of ours that takes focus carries .rs-f (covers and shelf tiles
   have their own rule, the ring goes around the art). The Steam client marks
   the focused element with .gpfocus, our Focusables add .is-focus, a browser
   marks keyboard focus with :focus-visible. */
.rs-store .rs-f { outline: none; cursor: pointer; }
.rs-store .rs-f.is-focus, .rs-store .rs-f.gpfocus, .rs-store .rs-f:focus-visible,
.rs-store .rs-btn.gpfocus, .rs-store .rs-btn:focus-visible,
.rs-store .rs-cta-btn.gpfocus, .rs-store .rs-cta-btn:focus-visible,
.rs-store .rs-shot.is-focus, .rs-store .rs-shot:focus-visible {
  outline: 3px solid var(--rs-focus);
  outline-offset: 2px;
}

/* Steam's dropdowns take no noFocusRing; their focused button gets our ring. */
.rs-store :is(.rs-filter, .rs-dest-select, .rs-dd) .gpfocus,
.rs-store :is(.rs-filter, .rs-dest-select, .rs-dd) :focus-visible {
  outline: 3px solid var(--rs-focus) !important; outline-offset: 2px; border-radius: 10px;
  box-shadow: none !important;
}

/* ------------------------------------------------------------- small parts */
.rs-h1 { margin: 0; font-size: 24px; line-height: 1.15; font-weight: 800; letter-spacing: -0.4px; color: var(--rs-text); }
.rs-h2 { margin: 0; font-size: 18px; line-height: 1.2; font-weight: 800; letter-spacing: -0.2px; color: var(--rs-text); }
.rs-h3 { margin: 0; font-size: 16px; line-height: 1.2; font-weight: 800; color: var(--rs-text); }
.rs-count { font-size: 13px; font-weight: 600; color: var(--rs-text-3); white-space: nowrap; }
.rs-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: var(--rs-accent); }
.rs-path { font-family: monospace; font-size: 12px; color: var(--rs-text-2); word-break: break-all; }
.rs-bad { color: var(--rs-bad); }
.rs-warn { color: var(--rs-warn); }

.rs-glyph {
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  min-width: 26px; height: 20px; padding: 0 5px; border-radius: 6px;
  background: rgba(255, 255, 255, 0.14); color: var(--rs-text-2);
  font-size: 11px; font-weight: 800; letter-spacing: 0.3px; line-height: 1;
}
.rs-glyph.round { min-width: 20px; width: 20px; padding: 0; border-radius: 50%; }

/* Meta lines: "Retrostic • 5.7MB • USA". */
.rs-meta { display: flex; flex-wrap: nowrap; align-items: center; font-size: 13px; color: var(--rs-text-2); min-width: 0; overflow: hidden; white-space: nowrap; }
.rs-meta > span { flex: 0 0 auto; }
.rs-meta > span:last-child { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rs-meta > span + span::before { content: "•"; margin: 0 8px; color: rgba(255, 255, 255, 0.24); }
.rs-file-source { color: var(--rs-accent); font-weight: 600; }

.rs-section { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.rs-section-head { display: flex; align-items: baseline; gap: 10px; min-width: 0; }

/* Buttons (Steam's Button underneath, so its own look is overridden). */
.rs-store .rs-btn {
  display: inline-flex !important; align-items: center; justify-content: center; gap: 8px;
  flex: 0 0 auto !important; width: auto !important; min-width: 0 !important;
  height: 40px !important; padding: 0 18px !important;
  border: none !important; border-radius: 10px !important;
  background: #ffffff !important; color: #0b0e13 !important;
  font-size: 14px !important; font-weight: 700 !important; line-height: 1 !important;
  white-space: nowrap; cursor: pointer;
}
.rs-store .rs-btn.ghost { background: var(--rs-surface-2) !important; color: var(--rs-text) !important; }
.rs-store .rs-btn.danger { background: rgba(255, 125, 107, 0.2) !important; color: #ffab9d !important; }
.rs-store .rs-btn:disabled { opacity: 0.45; cursor: default; }
.rs-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }

.rs-pill {
  display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto;
  height: 38px; padding: 0 16px; border-radius: 19px;
  background: var(--rs-surface-2); color: var(--rs-text);
  font-size: 14px; font-weight: 700; white-space: nowrap;
}
.rs-pill.off { opacity: 0.35; }

.rs-switch {
  position: relative; flex: 0 0 auto; width: 46px; height: 26px; border-radius: 13px;
  background: rgba(255, 255, 255, 0.18);
}
.rs-switch.on { background: var(--rs-accent); }
.rs-switch > span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; }
.rs-switch.on > span { left: 23px; }

.rs-progress { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.rs-progress > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--rs-accent), var(--rs-accent-2)); transition: width 200ms linear; }

.rs-spinner {
  flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18); border-top-color: var(--rs-accent);
  animation: rs-spin 700ms linear infinite;
}
@keyframes rs-spin { to { transform: rotate(360deg); } }
@keyframes rs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rs-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.rs-loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 64px 20px; color: var(--rs-text-2); font-size: 14px; }
.rs-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  margin: auto; padding: 40px 20px; text-align: center;
}
/* A view with nothing in it has nothing to scroll to. */
.rs-view.rs-scroll.is-empty { overflow: hidden; }
.rs-view.is-empty .rs-empty { flex: 1 1 auto; min-height: 0; margin: 0; padding: 12px 20px; }
.rs-empty-icon {
  width: 64px; height: 64px; border-radius: 50%; margin-bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  background: var(--rs-surface); color: var(--rs-text-2); font-size: 24px;
}
.rs-empty h2 { margin: 0; font-size: 20px; font-weight: 800; color: var(--rs-text); }
.rs-empty p { margin: 0 0 6px; max-width: 520px; font-size: 14px; line-height: 1.55; color: var(--rs-text-2); }

/* Dropdowns: Steam draws its own. This is the preview's stand-in. */
.rs-store select {
  appearance: none; -webkit-appearance: none;
  width: 100%; height: 38px; padding: 0 34px 0 14px;
  border: none; border-radius: 10px; outline: none;
  background: var(--rs-surface-2) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1.5l5 5 5-5' fill='none' stroke='%23aab3be' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat right 13px center;
  color: var(--rs-text); font: 600 14px "Motiva Sans", "Noto Sans", sans-serif;
  text-overflow: ellipsis; cursor: pointer;
}
.rs-store select.gpfocus, .rs-store select:focus-visible { outline: 3px solid var(--rs-focus); outline-offset: 2px; }

/* ----------------------------------------------------------------- shell */
/* Wraps everything behind the game page (one focus group for the d-pad). */
.rs-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }

.rs-top {
  flex: 0 0 auto; z-index: 5;
  display: flex; align-items: center; gap: 22px;
  height: 60px; padding: 0 var(--rs-pad);
  border-bottom: 1px solid var(--rs-line);
}
.rs-brand { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; font-size: 16px; font-weight: 800; letter-spacing: -0.2px; color: var(--rs-text); }
.rs-brand-mark {
  width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--rs-accent), var(--rs-accent-2)); color: #fff; font-size: 15px;
}
.rs-tabs { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.rs-tabs > .rs-glyph:first-child { margin-right: 6px; }
.rs-tabs > .rs-glyph:last-child { margin-left: 6px; }
.rs-tab {
  position: relative; display: flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 16px; border-radius: 19px;
  font-size: 15px; font-weight: 700; color: var(--rs-text-2); white-space: nowrap;
}
.rs-tab:hover { color: var(--rs-text); }
.rs-tab.active { background: var(--rs-surface-2); color: #fff; }
.rs-tab-badge {
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--rs-accent); color: #fff; font-size: 12px; font-weight: 800;
}
.rs-tab-progress { position: absolute; left: 16px; right: 16px; bottom: 4px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); overflow: hidden; }
.rs-tab-progress > span { display: block; height: 100%; background: var(--rs-accent); transition: width 200ms linear; }

.rs-search { position: relative; flex: 0 1 360px; min-width: 200px; margin-left: auto; }
.rs-search-icon { position: absolute; left: 15px; top: 50%; margin-top: -7px; z-index: 2; font-size: 14px; color: var(--rs-text-3); pointer-events: none; }
.rs-search > .rs-glyph { position: absolute; right: 12px; top: 50%; margin-top: -10px; z-index: 2; pointer-events: none; }
/* Steam's TextField carries a label and margins of its own. */
.rs-search-wrap > * { margin: 0 !important; }
.rs-search-wrap label { display: block; margin: 0 !important; }
/* Our text fields have no label; Steam's empty one must not take a line. */
.rs-search-wrap label:empty, .rs-row-control label:empty { display: none !important; }
.rs-search-wrap input {
  width: 100% !important; height: 40px !important; padding: 0 44px 0 40px !important;
  border: 1px solid transparent !important; border-radius: 20px !important;
  background: var(--rs-surface-2) !important; color: var(--rs-text) !important;
  font-size: 15px !important; font-weight: 600;
}
.rs-search-wrap input::placeholder { color: var(--rs-text-3); font-weight: 500; }
.rs-search-wrap input:focus, .rs-search-wrap input.gpfocus { border-color: var(--rs-focus) !important; outline: 2px solid var(--rs-focus); outline-offset: 1px; }

.rs-views { position: relative; flex: 1 1 auto; min-height: 0; }
.rs-view { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
/* The store behind another tab: still laid out (covers stay decoded, the
   scroll position stays), just not drawn. */
.rs-view.is-hidden { visibility: hidden; pointer-events: none; }
.rs-view.rs-scroll, .rs-view.rs-settings { animation: rs-fade 140ms ease-out; }
.rs-view.rs-scroll {
  overflow-y: auto; overscroll-behavior: contain;
  padding: 24px var(--rs-pad) 40px; gap: 24px;
  scroll-padding: 24px 0 32px;
}
.rs-view-head { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; min-height: 40px; }
.rs-view-title { display: flex; align-items: baseline; gap: 12px; flex: 1 1 auto; min-width: 0; }

/* No scrollbars: the d-pad and the touch screen scroll, a bar only adds noise. */
.rs-store, .rs-store * { scrollbar-width: none; }
.rs-store ::-webkit-scrollbar { display: none; width: 0; height: 0; }

/* The store's scroll area (home screen or the result grid). */
.rs-main {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  overflow-y: auto; overscroll-behavior: contain;
  padding: 10px var(--rs-pad) 32px;
  /* The grid is rebuilt only when the page changes; let the browser keep the
     scroll position where the user left it instead of re-anchoring. */
  overflow-anchor: none;
  /* A cover the d-pad scrolls to stops short of the edge, ring visible. */
  scroll-padding: 16px 0 28px;
}
.rs-main.rs-main-home { padding-top: 24px; }

/* ------------------------------------------------------------------ home */
.rs-home { display: flex; flex-direction: column; gap: 30px; }

.rs-shelf {
  display: flex; align-items: flex-start; gap: 16px;
  overflow-x: auto; overflow-y: hidden;
  margin: 0 calc(var(--rs-pad) * -1); padding: 5px var(--rs-pad) 6px;
  scrollbar-width: none; scroll-padding: 0 var(--rs-pad);
}
.rs-shelf::-webkit-scrollbar { display: none; }
.rs-shelf-tile { flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0; cursor: pointer; outline: none; }
.rs-shelf-art { position: relative; overflow: hidden; margin-bottom: 6px; background: #05070a; contain: paint; }
.rs-shelf-tile.is-focus .rs-shelf-art, .rs-shelf-tile:focus-visible .rs-shelf-art { outline: 3px solid var(--rs-focus); outline-offset: 2px; }
.rs-shelf-tile > .rs-shelf-title, .rs-shelf-tile > .rs-shelf-sub { width: 0; min-width: 100%; }
.rs-shelf-title {
  font-size: 13.5px; line-height: 1.25; font-weight: 700; color: var(--rs-text); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rs-shelf-sub { font-size: 12.5px; color: var(--rs-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-shelf-more {
  flex: 0 0 132px; height: 172px; border-radius: 14px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: var(--rs-surface); color: var(--rs-text-2); font-size: 14px; font-weight: 700;
}
.rs-shelf-more svg { font-size: 18px; }

.rs-consoles { display: grid; grid-template-columns: repeat(auto-fill, minmax(188px, 1fr)); gap: 12px; }
.rs-console {
  position: relative; overflow: hidden; min-width: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
  height: 68px; padding: 0 16px 0 22px; border-radius: 12px;
  background: var(--rs-surface);
}
.rs-console::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rs-tint, #8a95a3); }
.rs-console:hover, .rs-console.is-focus { background: var(--rs-surface-2); }
.rs-console-name { font-size: 15px; font-weight: 700; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-console-count { font-size: 12.5px; color: var(--rs-text-3); }

/* --------------------------------------------------------------- results */
.rs-results { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.rs-filterbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 16px var(--rs-pad) 10px; }
.rs-results-head { display: flex; align-items: baseline; gap: 12px; flex: 1 1 auto; min-width: 0; }
.rs-results-head .rs-h1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-filter { flex: 0 0 168px; min-width: 0; }
.rs-filter-console { flex-basis: 196px; }
.rs-filter > * { width: 100%; max-width: 100%; margin: 0 !important; }

/* Same column width for every cover, each in its own shape. Covers hang from
   a common top edge, so a shorter one (a near-square DS box, say) leaves its
   gap below rather than above. */
.rs-grid {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  column-gap: 14px;
  row-gap: 22px;
  align-items: start;
}
.rs-skeleton { animation: rs-pulse 1100ms ease-in-out infinite; }
.rs-skel { width: 100%; background: var(--rs-surface); }

.rs-card {
  position: relative;
  width: 100%;
  min-width: 0;
  cursor: pointer;
  outline: none;
  /* Own stacking context, so the shadow below can sit behind the art. No
     paint containment here: it would clip that shadow. The art inside is
     contained instead. */
  isolation: isolate;
  contain: layout style;
}
/* The soft shadow. A real blurred box-shadow on 30 covers made the Steam
   client repaint every one of them while scrolling (AGENTS.md §10), so this
   is a plain gradient painted once behind the cover: same look, no blur. */
.rs-card::before {
  content: "";
  position: absolute;
  inset: 6px -7px -12px;
  z-index: -1;
  border-radius: 18px;
  pointer-events: none;
  background: radial-gradient(closest-side, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.32) 58%, rgba(0, 0, 0, 0) 100%);
}
.rs-card:focus, .rs-card--focus { outline: 3px solid var(--rs-focus); outline-offset: 2px; }
.rs-card:hover:not(.rs-card--focus):not(:focus) { outline: 2px solid rgba(255, 255, 255, 0.4); outline-offset: 2px; }

/* The cover is the whole item. Art that is not the console's box shape is
   fitted inside the frame, never cropped (see CoverImage). */
.rs-card-art { position: absolute; inset: 0; overflow: hidden; background: #05070a; contain: paint; }

.rs-chip {
  position: absolute; top: 7px; left: 7px; z-index: 3;
  max-width: calc(100% - 14px); padding: 2px 7px 3px; border-radius: 6px;
  background: rgba(8, 11, 15, 0.8); color: #eef1f4;
  font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Top right: a star for a favourite, a check for a game in the library. */
.rs-marks { position: absolute; top: 6px; right: 6px; z-index: 3; display: flex; gap: 4px; }
.rs-mark {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; box-shadow: 0 0 0 2px rgba(8, 11, 15, 0.7);
}
.rs-mark.owned { background: var(--rs-good); color: #062310; }
.rs-mark.fav { background: var(--rs-gold); color: #2a1e00; }

/* No art: the title on the console's colour. */
.rs-noart {
  width: 100%; height: 100%; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; padding: 12px;
  background: linear-gradient(165deg, rgba(14, 18, 25, 0.56) 0%, rgba(14, 18, 25, 0.92) 70%, #0e1219 100%), var(--rs-tint, #8a95a3);
}
.rs-noart-title {
  font-size: 14px; line-height: 1.2; font-weight: 800; color: #fff; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.rs-noart-system { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; color: rgba(255, 255, 255, 0.72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-poster .rs-noart { padding: 20px; }
.rs-poster .rs-noart-title { font-size: 22px; }
.rs-poster .rs-noart-system { font-size: 12px; }

.rs-cover-img { position: relative; width: 100%; height: 100%; overflow: hidden; background: #05070a; }
.rs-cover-img img { position: relative; z-index: 1; width: 100%; height: 100%; display: block; object-fit: cover; }
/* Fitted art: the frame keeps its shape, the picture keeps its own. */
.rs-cover-img--contain img { object-fit: contain; }
/* Art a source resized to a fixed size, stretched back into the box shape. */
.rs-cover-img--fill img { object-fit: fill; }
/* A blown-up, dimmed copy of the art fills the space a fitted picture leaves,
   so the letterboxing looks like a deliberate glow instead of a gap. */
.rs-cover-ambient { position: absolute; inset: -10%; z-index: 0; background-position: center; background-size: cover; opacity: 0.5; pointer-events: none; }
.rs-cover-img--contain::after {
  content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 42%, rgba(5, 7, 10, 0.22) 0%, rgba(5, 7, 10, 0.72) 76%);
}
.rs-cover-placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: rgba(255, 255, 255, 0.13); font-size: 30px; background: linear-gradient(135deg, #0d1116, #080a0d);
}

.rs-pager { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; gap: 16px; padding: 30px 0 4px; }
.rs-pager-label { font-size: 14px; font-weight: 600; color: var(--rs-text-2); }

/* The line under the grid: the cover that has focus, in words. */
.rs-strip {
  flex: 0 0 auto; display: flex; align-items: center; gap: 14px;
  height: 46px; padding: 0 var(--rs-pad);
  border-top: 1px solid var(--rs-line); background: rgba(8, 10, 14, 0.72);
  font-size: 13px; color: var(--rs-text-2);
}
.rs-strip-title { flex: 0 1 auto; min-width: 0; font-size: 16px; font-weight: 800; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-strip-meta { display: flex; align-items: center; flex: 0 0 auto; white-space: nowrap; }
.rs-strip-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.rs-strip-meta > span + span::before { content: "•"; margin: 0 9px; color: rgba(255, 255, 255, 0.24); }
.rs-strip-rating { color: var(--rs-gold); font-weight: 700; }
.rs-strip-owned { color: var(--rs-good); font-weight: 700; }
.rs-strip-rating svg, .rs-strip-owned svg { font-size: 11px; }
.rs-strip-summary { color: var(--rs-text-3); }
.rs-strip-right { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; margin-left: auto; }
.rs-strip-page { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--rs-text-2); white-space: nowrap; }

.rs-issues {
  display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 12px; border-radius: 14px;
  background: rgba(255, 125, 107, 0.16); color: var(--rs-bad); font-size: 13px; font-weight: 700; white-space: nowrap;
}
.rs-issue-list {
  position: absolute; left: 0; right: 0; bottom: 46px; z-index: 4;
  max-height: 40%; overflow-y: auto; padding: 14px var(--rs-pad);
  background: var(--rs-panel); border-top: 1px solid rgba(255, 125, 107, 0.35);
}
.rs-issue-row { display: flex; gap: 10px; margin-bottom: 6px; font-size: 13px; }
.rs-issue-row b { flex: 0 0 auto; color: var(--rs-bad); }
.rs-issue-row span { color: var(--rs-text-2); word-break: break-word; }

/* ------------------------------------------------------------- game page */
/* On the whole store area: 1280 x 720 on the Deck. */
.rs-page {
  position: absolute; inset: 0; z-index: 40; overflow: hidden;
  display: grid; grid-template-columns: 308px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
  background: var(--rs-bg);
  animation: rs-fade 140ms ease-out;
}
/* A screenshot (or the cover) behind the title, faded out down and left. */
.rs-page-backdrop { position: absolute; top: 0; left: 0; right: 0; height: 400px; overflow: hidden; pointer-events: none; }
.rs-page-backdrop-art { position: absolute; inset: 0; background-position: center 25%; background-size: cover; opacity: 0.46; }
.rs-page-backdrop::after {
  content: ""; position: absolute; inset: 0;
  background:
    linear-gradient(180deg, rgba(11, 14, 19, 0.25) 0%, rgba(11, 14, 19, 0.78) 58%, #0b0e13 100%),
    linear-gradient(90deg, rgba(11, 14, 19, 0.92) 0%, rgba(11, 14, 19, 0.55) 38%, rgba(11, 14, 19, 0) 80%);
}
/* A band of its own above both columns, so nothing scrolls under it. */
.rs-page-nav { position: absolute; top: 14px; right: 24px; z-index: 6; display: flex; align-items: center; gap: 14px; }
.rs-page-pos {
  display: inline-flex; align-items: center; gap: 9px; height: 38px; padding: 0 12px; border-radius: 19px;
  background: rgba(8, 11, 15, 0.6); color: var(--rs-text-2); font-size: 13px; font-weight: 700; white-space: nowrap;
}
.rs-close {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(8, 11, 15, 0.6); color: var(--rs-text); font-size: 15px;
}
.rs-close:hover, .rs-close.is-focus { background: rgba(255, 255, 255, 0.2); }

/* A size container, so the poster can be measured against the column's height. */
.rs-page-side { position: relative; display: flex; flex-direction: column; gap: 22px; min-width: 0; min-height: 0; overflow: hidden; padding: 66px 0 28px 40px; container-type: size; }
/* The poster has its art's shape (--rs-ratio, width / height). A tall cover
   is made narrower rather than shorter: capping the height of a full-width
   frame would squash it towards a square and letterbox the art. */
.rs-poster {
  position: relative; flex: 0 0 auto; overflow: hidden; background: #05070a; box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
  width: 100%;
  width: min(100%, calc(66cqh * var(--rs-ratio, 0.714)));
}
/* Two columns: five facts under a tall poster still fit the 720px screen. */
.rs-facts { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; align-content: start; min-height: 0; overflow: hidden; }
.rs-fact { min-width: 0; }
.rs-fact:last-child:nth-child(odd) { grid-column: 1 / -1; }
.rs-fact dt { margin: 0 0 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; color: var(--rs-text-3); }
.rs-fact dd {
  margin: 0; font-size: 14px; line-height: 1.35; color: var(--rs-text); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.rs-page-main {
  position: relative; min-width: 0; min-height: 0;
  overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain;
  margin-top: 62px; padding: 6px 44px 44px 40px; scroll-padding: 14px 0 36px;
}
.rs-page-head { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.rs-title {
  margin: 0; font-size: 38px; line-height: 1.08; font-weight: 800; letter-spacing: -0.8px; color: #fff;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rs-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.rs-stat {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 15px;
  background: rgba(255, 255, 255, 0.1); color: var(--rs-text); font-size: 13px; font-weight: 700; white-space: nowrap;
}
.rs-stat svg { font-size: 11px; }
.rs-stat.rating { color: var(--rs-gold); }
.rs-stat.owned { background: rgba(106, 211, 122, 0.18); color: var(--rs-good); }

/* The main action. */
.rs-cta { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 58px; margin-top: 26px; }
.rs-store .rs-cta-btn {
  position: relative; overflow: hidden;
  display: inline-flex !important; align-items: center; justify-content: center;
  flex: 0 0 auto !important; width: auto !important; min-width: 232px !important;
  height: 58px !important; padding: 0 30px !important;
  border: none !important; border-radius: 16px !important;
  background: linear-gradient(100deg, var(--rs-accent) 0%, var(--rs-accent-2) 100%) !important;
  color: #fff !important; font-size: 18px !important; font-weight: 800 !important; line-height: 1 !important;
  cursor: pointer;
}
.rs-store .rs-cta-btn.gpfocus, .rs-store .rs-cta-btn:focus-visible { outline-offset: 3px; }
.rs-store .rs-cta-btn.busy, .rs-store .rs-cta-btn.quiet { background: var(--rs-surface-2) !important; }
.rs-store .rs-cta-btn:disabled { opacity: 0.6; }
.rs-cta-fill { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(100deg, var(--rs-accent), var(--rs-accent-2)); transition: width 200ms linear; }
.rs-cta-label { position: relative; display: inline-flex; align-items: center; gap: 11px; }
.rs-icon-btn {
  flex: 0 0 auto; width: 58px; height: 58px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  background: var(--rs-surface-2); color: var(--rs-text-2); font-size: 21px;
}
.rs-icon-btn.on { color: var(--rs-gold); }
.rs-cta-file { flex: 1 1 auto; min-width: 0; margin-left: 8px; }
.rs-cta-name { font-size: 15px; font-weight: 700; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-cta-file .rs-fastest { margin-top: 3px; font-size: 13px; }
.rs-cta-wait { display: flex; align-items: center; gap: 12px; height: 58px; padding: 0 22px; border-radius: 16px; background: var(--rs-surface); font-size: 15px; color: var(--rs-text-2); }
.rs-fastest { display: inline-flex; align-items: center; gap: 5px; color: var(--rs-good); font-weight: 700; }
.rs-fastest svg { font-size: 10px; }

/* BIOS note under the main action. */
.rs-bios {
  margin-top: 16px; padding: 12px 16px; border-radius: 12px;
  background: var(--rs-surface); font-size: 13px; line-height: 1.55; color: var(--rs-text-2);
}
.rs-bios b { color: var(--rs-text); }
.rs-bios.ok b { color: var(--rs-good); }
.rs-bios.missing { background: rgba(243, 189, 85, 0.1); box-shadow: inset 4px 0 0 var(--rs-warn); }
.rs-bios.missing b { color: var(--rs-warn); }

.rs-page-section { display: flex; flex-direction: column; gap: 12px; min-width: 0; margin-top: 34px; }
.rs-versions { display: flex; flex-direction: column; gap: 6px; }
.rs-version {
  display: flex; align-items: center; gap: 14px; min-width: 0; min-height: 58px;
  padding: 8px 12px 8px 18px; border-radius: 12px; background: var(--rs-surface);
}
.rs-version:hover, .rs-version.is-focus { background: var(--rs-surface-2); }
.rs-version.busy { opacity: 0.7; }
.rs-version-main { flex: 1 1 0; min-width: 0; }
.rs-version-name { font-size: 15px; font-weight: 600; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-version-get {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.08); color: var(--rs-text-2); font-size: 14px;
}
.rs-version.is-focus .rs-version-get { background: #fff; color: #0b0e13; }
.rs-version-error { font-size: 13px; color: var(--rs-bad); }
.rs-versions-more { align-self: flex-start; }

.rs-summary { margin: 0; max-width: 76ch; font-size: 15px; line-height: 1.65; color: var(--rs-text-2); }

/* Where the file goes: one quiet row at the end. */
.rs-dest { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 16px; border-radius: 12px; background: var(--rs-surface); }
.rs-dest-icon { flex: 0 0 auto; color: var(--rs-text-3); font-size: 15px; }
.rs-dest-select { flex: 0 0 240px; min-width: 0; }
.rs-dest-select.drive { flex-basis: 260px; }
.rs-dest-select > * { width: 100%; max-width: 100%; margin: 0 !important; }
.rs-dest-path { flex: 1 1 auto; min-width: 0; font-family: monospace; font-size: 12px; color: var(--rs-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Screenshots and the trailer. */
.rs-gallery {
  display: flex; gap: 12px; min-width: 0; max-width: 100%;
  overflow-x: auto; overflow-y: hidden; padding: 4px; margin: -4px;
  scrollbar-width: none; overscroll-behavior-x: contain;
}
.rs-gallery::-webkit-scrollbar { display: none; }
.rs-shot {
  position: relative; flex: 0 0 232px; width: 232px; height: 130px; padding: 0;
  border-radius: 10px; overflow: hidden; cursor: pointer; outline: none;
  background: #05070a; contain: paint;
}
.rs-shot > img, .rs-shot > div { width: 100%; height: 100%; object-fit: cover; display: block; }
.rs-shot-empty { width: 100%; height: 100%; background: linear-gradient(135deg, #10151b, #0a0d11); }
.rs-play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); color: #fff; font-size: 24px; }
.rs-lightbox {
  position: fixed; inset: 0; z-index: 80; background: rgba(0, 0, 0, 0.92);
  display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px;
}
.rs-lightbox:focus { outline: none; }
.rs-lightbox-frame { display: flex; align-items: center; justify-content: center; min-width: 200px; min-height: 120px; }
.rs-lightbox-image { width: min(92vw, 1280px); max-height: 78vh; object-fit: contain; border-radius: 8px; }
.rs-lightbox-note { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 14px; color: #aab3be; }
.rs-lightbox-video { width: min(1000px, 92vw); }
.rs-lightbox-video iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 10px; }
.rs-lightbox-close {
  position: absolute; top: 14px; right: 18px; width: 40px; height: 40px;
  border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 16px; cursor: pointer;
}
.rs-lightbox-bar { display: flex; align-items: center; gap: 14px; }
.rs-lightbox-count { font-size: 14px; font-weight: 800; color: #f1f3f6; }
.rs-lightbox-hint { font-size: 13px; color: #aab3be; display: flex; align-items: center; gap: 6px; }
.rs-lightbox-link { color: #3d9bff; font-size: 13px; }

/* --------------------------------------------------------------- library */
.rs-drives { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; flex: 0 0 auto; }
.rs-drive { padding: 16px 18px; border-radius: 14px; background: var(--rs-surface); }
.rs-drive-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.rs-drive-name { font-size: 15px; font-weight: 700; color: var(--rs-text); }
.rs-drive-free { font-size: 14px; font-weight: 700; color: var(--rs-text); }
.rs-drive-bar { display: flex; height: 8px; margin: 10px 0 8px; border-radius: 4px; overflow: hidden; background: rgba(255, 255, 255, 0.1); }
.rs-drive-bar > .roms { background: var(--rs-accent); }
.rs-drive-bar > .other { background: rgba(255, 255, 255, 0.3); }
.rs-drive-sub { font-size: 12.5px; color: var(--rs-text-3); }

.rs-lib-group { flex: 0 0 auto; }
.rs-lib-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.rs-lib-card {
  display: flex; align-items: center; gap: 14px; min-width: 0; min-height: 84px;
  padding: 10px 18px 10px 10px; border-radius: 14px; background: var(--rs-surface);
}
.rs-lib-card:hover, .rs-lib-card.is-focus { background: var(--rs-surface-2); }
.rs-lib-card.asking { background: rgba(255, 125, 107, 0.12); box-shadow: inset 0 0 0 1px rgba(255, 125, 107, 0.4); padding-right: 12px; }
.rs-lib-thumb, .rs-dl-thumb { flex: 0 0 auto; height: 64px; overflow: hidden; border-radius: 4px; background: #05070a; }
.rs-lib-thumb .rs-noart, .rs-dl-thumb .rs-noart { padding: 0; }
.rs-lib-thumb .rs-noart > *, .rs-dl-thumb .rs-noart > * { display: none; }
.rs-lib-main { flex: 1 1 auto; min-width: 0; }
.rs-lib-title { font-size: 15px; font-weight: 700; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-lib-meta { display: flex; flex-wrap: wrap; align-items: center; margin-top: 3px; font-size: 13px; color: var(--rs-text-2); }
.rs-lib-meta > span + span::before { content: "•"; margin: 0 8px; color: rgba(255, 255, 255, 0.24); }
.rs-lib-card.asking .rs-lib-meta { color: #ffb5a9; }
.rs-lib-steam { display: inline-flex; align-items: center; gap: 5px; color: var(--rs-accent); font-weight: 600; }
.rs-lib-size { flex: 0 0 auto; font-size: 15px; font-weight: 700; color: var(--rs-text-2); white-space: nowrap; }

/* ------------------------------------------------------------- downloads */
.rs-dl-list { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; }
.rs-dl { display: flex; align-items: center; gap: 18px; min-width: 0; padding: 14px 18px 14px 14px; border-radius: 14px; background: var(--rs-surface); }
.rs-dl-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.rs-dl-top { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; min-width: 0; }
.rs-dl-title { min-width: 0; font-size: 16px; font-weight: 700; color: var(--rs-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rs-dl-pct { flex: 0 0 auto; font-size: 15px; font-weight: 800; color: var(--rs-accent); }
.rs-dl-row { display: flex; align-items: center; gap: 16px; min-width: 0; min-height: 62px; padding: 8px 18px 8px 14px; border-radius: 12px; background: var(--rs-surface); }
.rs-dl-row:hover, .rs-dl-row.is-focus { background: var(--rs-surface-2); }
.rs-dl-row .rs-dl-main { gap: 2px; }
.rs-dl-row .rs-dl-title { font-size: 15px; }
.rs-dl-state {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.1); color: var(--rs-text-2); font-size: 13px;
}
.rs-dl-row.done .rs-dl-state { background: rgba(106, 211, 122, 0.2); color: var(--rs-good); }
.rs-dl-row.error .rs-dl-state { background: rgba(255, 125, 107, 0.2); color: var(--rs-bad); }

/* -------------------------------------------------------------- settings */
.rs-view.rs-settings { display: grid; grid-template-columns: 252px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.rs-set-nav { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow-y: auto; padding: 24px 14px 20px var(--rs-pad); border-right: 1px solid var(--rs-line); }
.rs-set-nav-item {
  display: flex; align-items: center; gap: 12px; flex: 0 0 auto;
  height: 46px; padding: 0 14px; border-radius: 12px;
  font-size: 15px; font-weight: 700; color: var(--rs-text-2);
}
.rs-set-nav-item svg { flex: 0 0 auto; font-size: 15px; }
.rs-set-nav-item:hover { color: var(--rs-text); }
.rs-set-nav-item.active { background: var(--rs-surface-2); color: #fff; }
.rs-set-saved { margin-top: auto; padding: 12px 14px 0; font-size: 12.5px; color: var(--rs-text-3); }
.rs-set-saved.saved { color: var(--rs-good); }
.rs-set-saved.error { color: var(--rs-bad); }
.rs-set-pane { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px var(--rs-pad) 44px 32px; scroll-padding: 24px 0 36px; animation: rs-fade 120ms ease-out; }
.rs-set-lead { margin: 6px 0 20px; max-width: 70ch; font-size: 14px; color: var(--rs-text-2); }
.rs-group { margin: 24px 0 10px; font-size: 12px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: var(--rs-text-3); }
.rs-group:first-of-type { margin-top: 0; }

.rs-row {
  display: flex; align-items: center; gap: 24px; min-width: 0; min-height: 62px;
  margin-bottom: 8px; padding: 12px 18px; border-radius: 14px; background: var(--rs-surface);
}
.rs-row-toggle:hover, .rs-row-toggle.is-focus { background: var(--rs-surface-2); }
.rs-row-text { flex: 1 1 auto; min-width: 0; }
.rs-row-label { font-size: 15px; font-weight: 700; color: var(--rs-text); }
.rs-row-hint { margin-top: 3px; max-width: 74ch; font-size: 13px; line-height: 1.5; color: var(--rs-text-3); }
.rs-row-control { flex: 0 0 220px; min-width: 0; display: flex; justify-content: flex-end; }
.rs-row-control.wide { flex-basis: 420px; }
.rs-row-control.fit { flex: 0 0 auto; }
.rs-row-control > * { margin: 0 !important; }
.rs-row-control:not(.fit) > * { flex: 1 1 auto; min-width: 0; width: 100%; }
.rs-row-control input {
  width: 100% !important; height: 40px !important; padding: 0 14px !important;
  border: 1px solid transparent !important; border-radius: 10px !important;
  background: rgba(0, 0, 0, 0.32) !important; color: var(--rs-text) !important; font-size: 14px !important;
}
.rs-row-control input:focus, .rs-row-control input.gpfocus { border-color: var(--rs-focus) !important; outline: 2px solid var(--rs-focus); outline-offset: 1px; }
.rs-row-value { font-size: 14px; font-weight: 700; color: var(--rs-text-2); white-space: nowrap; }
.rs-source { margin-bottom: 18px; }
.rs-source > .rs-row { margin-bottom: 4px; }
.rs-source > .rs-row + .rs-row { min-height: 0; padding-top: 8px; padding-bottom: 8px; background: rgba(255, 255, 255, 0.03); }
.rs-source > .rs-row + .rs-row .rs-row-label { font-size: 13px; font-weight: 600; color: var(--rs-text-3); }
.rs-health { display: block; margin-bottom: 3px; font-weight: 700; }
.rs-health.ok { color: var(--rs-good); }
.rs-health.warn { color: var(--rs-warn); }
.rs-health.bad { color: var(--rs-bad); }
.rs-health.idle { color: var(--rs-text-3); }
.rs-note { margin: 0 0 8px; padding: 12px 18px; border-radius: 14px; background: rgba(61, 155, 255, 0.08); font-size: 13px; line-height: 1.5; color: var(--rs-text-2); }
.rs-note.warn { background: rgba(243, 189, 85, 0.1); color: #f7d490; }
.rs-diagnostics {
  margin: 0 0 8px; padding: 12px 16px; border-radius: 12px; max-height: 220px; overflow: auto;
  background: rgba(0, 0, 0, 0.35); font-size: 12px; line-height: 1.5; color: var(--rs-text-2);
  white-space: pre-wrap; word-break: break-all;
}

/* ----------------------------------------------------------- error screen */
.rs-error-screen { padding: 40px 30px; color: #d6d7d8; max-width: 900px; margin: 0 auto; }
.rs-error-screen h2 { margin: 0 0 8px; font-size: 20px; color: #ff7d6b; }
.rs-error-screen p { margin: 0 0 14px; font-size: 14px; color: #aab3be; }
.rs-error-screen pre {
  background: #0d0f12; border: 1px solid rgba(255, 125, 107, 0.3); border-radius: 8px;
  padding: 14px; font-size: 12px; color: #ffb59e; white-space: pre-wrap;
  word-break: break-word; margin: 0 0 16px; max-height: 40vh; overflow: auto;
}
`;

let injected = false;

/**
 * Fallback: inject the sheet into the document head.
 *
 * Decky renders plugin content inside the Steam client DOM, but the head is
 * owned by Steam and can be replaced when the client re-renders, which drops
 * the sheet and leaves the plugin completely unstyled. The stylesheet is
 * therefore also rendered as part of the React tree (see <StoreStyles />),
 * where it lives and dies with the plugin content.
 */
export function injectStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.id = "rom-store-styles";
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}
