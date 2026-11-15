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
  /* The grid is rebuilt only when the page changes; let the browser keep the
     scroll position where the user left it instead of re-anchoring. */
  overflow-anchor: none;
}
.rs-main::-webkit-scrollbar { width: 10px; }
.rs-main::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.25); }
.rs-main::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 5px; }
.rs-main::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }
.rs-bottom-space { height: var(--rs-chrome-bottom, 40px); flex: 0 0 auto; }

.rs-pager {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  padding: 18px 0 8px;
}
.rs-pager-label { font-size: 12px; color: #8b949d; }

.rs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(142px, 1fr));
  gap: 14px;
}

/* ---------------------------------------------------------------- grid item */
.rs-card {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.075);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));
  overflow: hidden;
  cursor: pointer;
  outline: none;
  /* No transform, no animated artwork and no big blur shadow: each of those
     forced the Steam client to promote and repaint every cover while moving
     through the grid. A border, a background colour and an outline are cheap. */
  contain: layout paint style;
  transition: border-color 110ms ease, background-color 110ms ease;
}
.rs-card:hover, .rs-card:focus, .rs-card--focus {
  border-color: rgba(102, 192, 244, 0.75);
  background-color: rgba(255, 255, 255, 0.05);
}
.rs-card--focus {
  outline: 2px solid #66c0f4;
  outline-offset: -2px;
  background-color: rgba(102, 192, 244, 0.08);
}

/* Every console gets the same poster frame so the rows stay even. 5:7 is the
   shape IGDB publishes cover art in, so most artwork fills it exactly. Art
   that is shaped differently is fitted inside the frame, never cropped. */
.rs-card-art {
  position: relative;
  width: 100%;
  aspect-ratio: 5 / 7;
  overflow: hidden;
  background: #05070a;
}
/* A soft top-and-bottom scrim sits over the artwork so white covers still
   separate from the card body. It does not touch the picture. */
.rs-card-art::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.12) 0%, rgba(0, 0, 0, 0) 26%, rgba(0, 0, 0, 0.28) 100%);
}

.rs-cover-img {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #05070a;
}
.rs-cover-img img {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
/* Fitted art: the frame keeps its shape, the picture keeps its own. */
.rs-cover-img--contain img { object-fit: contain; }
/* A blown-up, dimmed copy of the art fills the space a fitted picture leaves,
   so the letterboxing looks like a deliberate glow instead of a gap. */
.rs-cover-ambient {
  position: absolute;
  inset: -10%;
  z-index: 0;
  background-position: center;
  background-size: cover;
  opacity: 0.5;
  pointer-events: none;
}
.rs-cover-img--contain::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 42%, rgba(5, 7, 10, 0.22) 0%, rgba(5, 7, 10, 0.72) 76%);
}
.rs-cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.13);
  font-size: 30px;
  background: linear-gradient(135deg, #0d1116, #080a0d);
}

.rs-card-body {
  padding: 9px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.rs-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #f2f3f3;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 31px;
  word-break: break-word;
}
.rs-card-meta { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 14px; }
.rs-chip {
  position: absolute;
  top: 7px;
  left: 7px;
  z-index: 3;
  max-width: calc(100% - 14px);
  padding: 1px 6px 2px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(6, 10, 14, 0.74);
  color: #e2e8ed;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rs-card-stats { display: inline-flex; gap: 8px; font-size: 10.5px; color: #8b949d; }
.rs-stat { white-space: nowrap; }
.rs-stat.rating { color: #ffd766; }

.rs-pill {
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 10.5px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
  color: #c3c8cd;
  white-space: nowrap;
}
.rs-pill.system,
.rs-pill.variants {
  background: rgba(102, 192, 244, 0.16);
  color: #66c0f4;
  font-weight: 700;
  letter-spacing: 0.3px;
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
.rs-foot-hint { color: #79838c; }
.rs-foot-hint b { color: #c9ced3; font-weight: 600; }

.rs-hintbar {
  display: flex; gap: 14px; align-items: center; justify-content: flex-end;
  font-size: 11px; color: #79838c; padding: 6px 2px 0;
}
.rs-hintbar b { color: #c9ced3; font-weight: 600; }

/* The Steam controller moves focus with the d-pad - make it obvious where
   the focus currently is. */
.rs-btn:focus-visible,
.rs-close:focus-visible,
.rs-shot:focus-visible,
.rs-browse-tile:focus-visible,
.rs-steam-btn:focus-visible,
.rs-icon-btn:focus-visible {
  outline: 2px solid #66c0f4;
  outline-offset: 1px;
}

.rs-diagnostics {
  background: #0d0f12; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  padding: 10px 12px; font-size: 11px; color: #9aa4ad; margin: 0 0 14px;
  white-space: pre-wrap; word-break: break-all; max-height: 220px; overflow: auto;
}

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
.rs-panel.detail { width: min(1060px, 100%); max-height: min(760px, 100%); }
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

/* ------------------------------------------------------------ game detail */
.rs-detail-hero {
  position: relative;
  flex: 0 0 auto;
  padding: 20px 22px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.rs-detail-hero-art {
  position: absolute;
  inset: 0;
  background-position: center 30%;
  background-size: cover;
  opacity: 0.28;
  pointer-events: none;
}
.rs-detail-hero::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(100deg, rgba(27, 31, 36, 0.97) 0%, rgba(27, 31, 36, 0.88) 42%, rgba(27, 31, 36, 0.55) 100%);
}
.rs-detail-hero-inner {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.rs-detail-heading { display: flex; align-items: flex-start; gap: 14px; min-width: 0; }
.rs-detail-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 26px;
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: #fff;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rs-detail-sub { font-size: 12px; color: #9aa4ad; min-height: 15px; }
.rs-detail-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.rs-close {
  flex: 0 0 auto;
  width: 30px; height: 30px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.35);
  color: #d6d7d8;
  font-size: 14px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.rs-close:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }

/* One scroll area for the whole body: poster, links and screenshots together. */
.rs-detail-body {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 208px minmax(0, 1fr);
  align-items: start;
  gap: 22px;
  padding: 18px 22px 20px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.rs-detail-body::-webkit-scrollbar { width: 8px; }
.rs-detail-body::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.2); }
.rs-detail-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }

.rs-detail-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.rs-detail-poster {
  position: relative;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  background: #05070a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  contain: paint;
}
.rs-detail-cover-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; font-weight: 800; color: rgba(255, 255, 255, 0.12);
  background: #05070a;
}

.rs-save {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.035);
  min-width: 0;
}
.rs-save > * { max-width: 100%; }
.rs-save-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  color: #79838c;
}
.rs-save-path {
  font-family: monospace;
  font-size: 10px;
  line-height: 1.4;
  color: #8b949d;
  word-break: break-all;
  max-height: 2.8em;
  overflow: hidden;
}

.rs-detail-main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.rs-detail-loading {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: #8b949d; padding: 4px 0;
}
.rs-summary {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #a9b2ba;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rs-file-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 10px; font-weight: 700; letter-spacing: 0.9px; text-transform: uppercase;
  color: #79838c;
}
.rs-file-count { font-weight: 500; letter-spacing: 0.4px; color: #6f7a83; }
.rs-file-group { display: flex; flex-direction: column; gap: 8px; }
.rs-file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.035);
  min-width: 0;
}
.rs-file:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(102, 192, 244, 0.35); }
.rs-file-main { flex: 1 1 0; min-width: 0; }
.rs-file-name {
  font-size: 12.5px; font-weight: 600; color: #e6e8ea;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rs-file-meta {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  margin-top: 3px; font-size: 11px; color: #8b949d;
}
.rs-file-source { color: #66c0f4; }
.rs-sep { color: rgba(255, 255, 255, 0.22); }
.rs-file-btn {
  flex: 0 0 auto !important;
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  padding: 6px 12px !important;
  font-size: 12px !important;
  border-radius: 7px !important;
}

.rs-detail-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(0, 0, 0, 0.22);
  font-size: 11px;
  color: #79838c;
}
.rs-detail-foot b { color: #c9ced3; font-weight: 600; }
.rs-detail-foot-dest {
  font-family: monospace;
  font-size: 10.5px;
  color: #8b949d;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
  scrollbar-width: thin;
  contain: layout paint;
  overscroll-behavior-x: contain;
}
.rs-gallery::-webkit-scrollbar { height: 0; width: 0; display: none; }
.rs-gallery { scrollbar-width: none; }
.rs-shot {
  position: relative; flex: 0 0 190px; width: 190px; height: 107px; padding: 0;
  border-radius: 6px; overflow: hidden; cursor: pointer;
  border: 1px solid rgba(255,255,255,0.12); background: #05070a;
  contain: paint;
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
