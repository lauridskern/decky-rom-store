/** Styles for the ROM Store, injected at runtime (Decky does not load CSS files). */
export const CSS = `
.rs-store {
  /* The Steam client draws a header bar over the top of the window and a
     button bar over the bottom. The store lives between them and scrolls on
     its own; a spacer at the end of the list keeps the last card reachable. */
  position: fixed;
  top: var(--rs-chrome-top, var(--basicui-header-height, 40px));
  bottom: var(--rs-chrome-bottom, 40px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #16191d 0%, #0f1114 100%);
  color: #d6d7d8;
  font-family: "Motiva Sans", "Noto Sans", sans-serif;
  font-size: 14px;
  user-select: none;
}

.rs-header {
  flex: 0 0 auto;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: 0 0 auto;
}

.rs-search-wrap { flex: 1 1 200px; min-width: 140px; position: relative; }
/* Steam's TextField carries a floating label - shrink it for the header. */
.rs-search-wrap > * { margin: 0 !important; }
.rs-search-wrap label { font-size: 8.5px !important; line-height: 1 !important; margin-bottom: 1px !important; }
.rs-search-wrap input {
  height: 30px !important; padding-top: 2px !important; padding-bottom: 2px !important;
  font-size: 13px !important; border-radius: 4px !important;
}
.rs-search-wrap input:focus { border-color: #66c0f4; }

.rs-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
}
.rs-filters > * { min-width: 0; }

.rs-steam-btn {
  min-width: 32px !important;
  height: 30px !important;
  padding: 0 8px !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}
.rs-steam-btn.active { color: #66c0f4 !important; }
.rs-icon-btn-wrap { position: relative; display: inline-flex; }
.rs-badge-count {
  position: absolute; top: -6px; right: -6px;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 9px; background: #66c0f4; color: #0b1a24;
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}

.rs-main {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px 18px 28px;
}
.rs-main::-webkit-scrollbar { width: 10px; }
.rs-main::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.25); }
.rs-main::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 5px; }
.rs-main::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
.rs-bottom-space { height: var(--rs-chrome-bottom, 40px); flex: 0 0 auto; }

.rs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
}

.rs-card {
  min-width: 0;
  /* Off screen cards are not painted at all - this is what makes a long
     grid feel smooth on the Deck. */
  content-visibility: auto;
  contain-intrinsic-size: 130px 230px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  display: flex; flex-direction: column;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
  outline: none;
}
.rs-card:hover, .rs-card:focus, .rs-card--focus {
  transform: translateY(-2px);
  border-color: rgba(102, 192, 244, 0.75);
  background: rgba(255, 255, 255, 0.07);
}
.rs-card--focus {
  box-shadow: 0 0 0 2px #66c0f4, 0 10px 26px rgba(0, 0, 0, 0.55);
}

.rs-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: #05070a;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.rs-cover > div { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.rs-cover img {
  position: relative;
  width: 100%; height: 100%;
  /* Fill the poster frame: portrait art fits exactly, landscape art is
     cropped to its centre instead of being letterboxed. */
  object-fit: cover;
}
.rs-cover .rs-placeholder { font-size: 34px; color: rgba(255,255,255,0.14); display: flex; }
.rs-pill.system {
  background: rgba(102, 192, 244, 0.16);
  color: #66c0f4;
  font-weight: 700;
  letter-spacing: 0.3px;
}
.rs-pill.variants {
  background: rgba(102, 192, 244, 0.16);
  color: #66c0f4;
  font-weight: 700;
}

.rs-card-body { padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow: hidden; }
.rs-title {
  font-size: 12px; font-weight: 600; color: #f2f3f3; line-height: 1.2;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: 29px;
}
.rs-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #9aa4ad; }
.rs-pill {
  border-radius: 9px; padding: 0 6px; font-size: 9.5px; font-weight: 600;
  background: rgba(255,255,255,0.08); color: #c3c8cd; white-space: nowrap;
}
.rs-pill.romspedia { background: rgba(102,192,244,0.16); color: #66c0f4; }
.rs-pill.dumbroms { background: rgba(153,204,255,0.14); color: #99ccff; }
.rs-pill.myabandonware { background: rgba(255,153,85,0.16); color: #ff9955; }
.rs-pill.retrostic { background: rgba(168,120,255,0.16); color: #a878ff; }
.rs-pill.switchroms { background: rgba(255,95,95,0.16); color: #ff7b7b; }
.rs-pill.romsdl { background: rgba(255,120,180,0.14); color: #ff78b4; }
.rs-pill.region { background: rgba(178,255,102,0.14); color: #b2ff66; }
.rs-pill.rating { background: rgba(255,215,102,0.14); color: #ffd766; }

.rs-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 60px 20px; color: #7d8790; text-align: center;
}
.rs-empty h2 { margin: 0; font-size: 18px; color: #c9ced3; }
.rs-empty p { margin: 0; font-size: 13px; max-width: 520px; line-height: 1.5; }

.rs-footer {
  position: sticky;
  bottom: var(--rs-chrome-bottom, 40px);
  z-index: 5;
  flex: 0 0 auto; display: flex; align-items: center; gap: 14px;
  padding: 8px 18px; font-size: 11px; color: #79838c;
  border-top: 1px solid rgba(255,255,255,0.07); background: rgba(0,0,0,0.25);
}
.rs-footer .rs-path { font-family: monospace; }
.rs-error { color: #ff8f6b; }
.rs-issues {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(255,143,107,0.14); color: #ff8f6b;
  border: 1px solid rgba(255,143,107,0.35); border-radius: 10px;
  padding: 1px 8px; font-size: 11px; cursor: pointer;
}
.rs-issues:hover { background: rgba(255,143,107,0.24); }
.rs-issue-list {
  position: absolute; left: 0; right: 0; bottom: 100%;
  background: #1b1f24; border-top: 1px solid rgba(255,143,107,0.3);
  padding: 10px 18px; max-height: 40vh; overflow-y: auto;
}
.rs-issue-row { display: flex; gap: 8px; font-size: 12px; margin-bottom: 6px; }
.rs-issue-row b { color: #ff8f6b; flex: 0 0 auto; }
.rs-issue-row span { color: #9aa4ad; word-break: break-word; }

/* ---------------------------------------------------------------- overlay */
.rs-overlay {
  position: absolute; inset: 0; z-index: 40;
  background: rgba(0, 0, 0, 0.68);
  display: flex; align-items: center; justify-content: center;
  padding: 14px;
  box-sizing: border-box;
  overflow: hidden;
}
.rs-panel {
  background: #1b1f24; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.6);
  max-height: 100%; max-width: 100%;
  display: flex; flex-direction: column; overflow: hidden;
  box-sizing: border-box;
}
.rs-panel.detail { width: min(1020px, 100%); }
.rs-panel.settings { width: min(720px, 100%); }
.rs-panel-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; min-width: 0; }
.rs-detail-grid { min-width: 0; }
.rs-detail-grid > div { min-width: 0; }
.rs-panel.drawer {
  position: absolute; right: 0; top: 0; bottom: 0;
  width: min(460px, 92%);
  border-radius: 12px 0 0 12px; max-height: 100%;
}
.rs-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08);
}
.rs-panel-head h3 { margin: 0; font-size: 16px; color: #fff; }
.rs-panel-body { padding: 16px 18px; overflow-y: auto; }

.rs-detail-grid { display: grid; grid-template-columns: 190px 1fr; gap: 16px; }
.rs-detail-cover {
  position: relative;
  aspect-ratio: 3/4; width: 100%; background: #05070a;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);
  overflow: hidden; display: flex; align-items: center; justify-content: center;
}
.rs-detail-cover img { position: relative; width: 100%; height: 100%; object-fit: cover; }
.rs-detail-cover-sm { max-width: 190px; }
.rs-detail-cover-placeholder {
  aspect-ratio: 3/4; width: 100%; background: #05070a; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; font-size: 48px; color: rgba(255,255,255,0.1); font-weight: 800;
  border: 1px solid rgba(255,255,255,0.08);
}
.rs-detail-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.rs-detail-titlebar {
  display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px;
}
.rs-detail-title { font-size: 20px; font-weight: 700; color: #fff; margin: 0; flex: 1 1 auto; }
.rs-close {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06);
  color: #d6d7d8; font-size: 14px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.rs-close:hover { background: rgba(255,255,255,0.16); color: #fff; }

.rs-variant {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
  background: rgba(255,255,255,0.03); margin-bottom: 8px;
  max-width: 100%; overflow: hidden; box-sizing: border-box;
}
.rs-variant:hover { border-color: rgba(102,192,244,0.5); }
.rs-variant-main { flex: 1 1 0; min-width: 0; overflow: hidden; }
.rs-variant .rs-btn { flex: 0 0 auto; }
.rs-variant-name {
  font-size: 13px; color: #e6e8ea; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; display: block; max-width: 100%;
}
.rs-variant-sub { font-size: 11px; color: #8b949d; margin-top: 2px; }

.rs-btn {
  border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600;
  background: #66c0f4; color: #0a1a24; cursor: pointer; white-space: nowrap;
  flex: 0 0 auto;
}
.rs-btn:hover { background: #7fcbf8; }
.rs-btn:disabled { opacity: .45; cursor: default; }
.rs-btn.ghost { background: rgba(255,255,255,0.08); color: #d6d7d8; }
.rs-btn.ghost:hover { background: rgba(255,255,255,0.16); }
.rs-btn.danger { background: rgba(255,120,90,0.16); color: #ff8f6b; }

.rs-dl-row {
  border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px; margin-bottom: 9px;
  background: rgba(255,255,255,0.03); max-width: 100%; overflow: hidden;
}
.rs-dl-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.rs-dl-name {
  flex: 1 1 0; min-width: 0; font-size: 13px; color: #e6e8ea;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rs-dl-status { font-size: 11px; font-weight: 600; flex: 0 0 auto; white-space: nowrap; }
.rs-progress { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); overflow: hidden; margin-top: 8px; }
.rs-progress > div { height: 100%; background: linear-gradient(90deg, #66c0f4, #a4d007); transition: width 200ms linear; }
.rs-dl-sub {
  display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: #8b949d;
  margin-top: 5px; min-width: 0;
}
.rs-dl-sub > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.rs-form-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.rs-form-row label { flex: 0 0 190px; font-size: 13px; color: #c9ced3; }
.rs-form-row input[type="text"], .rs-form-row select {
  flex: 1 1 auto; min-width: 0; padding: 8px 10px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.35); color: #fff; font-size: 13px;
}
.rs-form-row input:focus { outline: none; border-color: #66c0f4; }
.rs-form-row .rs-hint { flex: 1 1 100%; font-size: 11px; color: #79838c; margin-top: -6px; }
.rs-switch { position: relative; width: 40px; height: 22px; border-radius: 11px; background: rgba(255,255,255,0.15); cursor: pointer; transition: background 150ms; }
.rs-switch.on { background: #66c0f4; }
.rs-switch > span { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 150ms; }
.rs-switch.on > span { left: 21px; }

.rs-section-title {
  font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #79838c;
  margin: 18px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 6px;
}

.rs-main.is-loading { display: flex; align-items: center; justify-content: center; }
.rs-main.is-empty { overflow: hidden; display: flex; align-items: center; justify-content: center; }
.rs-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px; color: #8b949d; text-align: center;
}
.rs-spinner {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.15); border-top-color: #66c0f4;
  animation: rs-spin 700ms linear infinite;
}
@keyframes rs-spin { to { transform: rotate(360deg); } }

.rs-error-screen {
  padding: 40px 30px; color: #d6d7d8; max-width: 900px; margin: 0 auto;
}
.rs-error-screen h2 { margin: 0 0 8px; font-size: 20px; color: #ff8f6b; }
.rs-error-screen p { margin: 0 0 14px; font-size: 13px; color: #9aa4ad; }
.rs-error-screen pre {
  background: #0d0f12; border: 1px solid rgba(255,143,107,0.3); border-radius: 8px;
  padding: 14px; font-size: 12px; color: #ffb59e; white-space: pre-wrap;
  word-break: break-word; margin: 0 0 16px; max-height: 40vh; overflow: auto;
}

.rs-summary {
  margin: 0 0 12px; font-size: 12px; line-height: 1.55; color: #9aa4ad;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}

.rs-gallery {
  display: flex; gap: 8px;
  overflow-x: auto; overflow-y: hidden;
  max-width: 100%; min-width: 0;
  padding: 2px 0 8px; margin-bottom: 10px;
  scrollbar-width: thin; scroll-snap-type: x proximity;
  contain: layout paint;
  overscroll-behavior-x: contain;
}
.rs-gallery::-webkit-scrollbar { height: 0; width: 0; display: none; }
.rs-gallery { scrollbar-width: none; }
.rs-shot {
  position: relative; flex: 0 0 168px; width: 168px; height: 96px; padding: 0;
  border-radius: 6px; overflow: hidden; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.12); background: #05070a;
  scroll-snap-align: start; contain: paint;
}
.rs-shot > img,
.rs-shot > div {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.rs-shot-empty {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, #10151b, #0a0d11);
}
.rs-gallery, .rs-shot { contain: paint; }
.rs-shot:hover { border-color: rgba(102,192,244,0.7); }
.rs-play {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.35); color: #fff; font-size: 22px;
}
.rs-lightbox {
  position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.88);
  display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px;
}
.rs-lightbox-image { max-width: 92vw; max-height: 78vh; object-fit: contain; border-radius: 6px; }
.rs-lightbox-video { width: min(1000px, 92vw); }
.rs-lightbox-video iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 8px; }
.rs-lightbox-close {
  position: absolute; top: 14px; right: 18px; width: 38px; height: 38px;
  border-radius: 50%; border: 1px solid rgba(255,255,255,0.25);
  background: rgba(0,0,0,0.5); color: #fff; font-size: 16px; cursor: pointer;
}
.rs-lightbox-hint { font-size: 11px; color: #8f98a0; display: flex; align-items: center; gap: 6px; }
.rs-lightbox-link { color: #66c0f4; font-size: 12px; }

.rs-browse-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(138px, 1fr)); gap: 10px;
}
.rs-browse-tile {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
  color: #e6e8ea; font-size: 13px; text-align: left;
  /* Without this the grid column grows to the longest label and we end up
     with fewer tiles per row than intended. */
  min-width: 0; overflow: hidden;
}
.rs-browse-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-browse-count { flex: 0 0 auto; }
.rs-browse-tile:hover { border-color: rgba(102,192,244,0.6); background: rgba(255,255,255,0.08); }
.rs-browse-name { font-weight: 600; }
.rs-browse-count { color: #8f98a0; font-size: 12px; }

.rs-plain-menu { padding: 6px 0; }
.rs-plain-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.rs-plain-row input[type="text"] {
  flex: 1 1 auto; padding: 8px 10px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.35); color: #fff;
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
