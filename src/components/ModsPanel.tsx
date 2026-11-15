import { FC, useCallback, useEffect, useRef, useState } from "react";
import { toaster } from "@decky/api";
import { Button, Focusable } from "@decky/ui";
import { FaCheck, FaDownload, FaHeart, FaPuzzlePiece, FaStore, FaTimes, FaTrash } from "react-icons/fa";
import { cancelMod, getGameMods, getModJob, GameMods, InstalledGame, installMod, ModInfo, ModJob, removeMod } from "../types";
import { boxRatio, formatBytes, systemLabel } from "./common";
import CoverImage from "./CoverImage";
import { NoArt } from "./RomCard";
import { focusElement } from "./gamepad";
import { useBackGuard } from "./useBackGuard";
import { Progress, Spinner } from "./ui";

interface Props {
  game: InstalledGame;
  onClose: () => void;
  /** X / the button at the bottom: the uninstall question, back in the list. */
  onUninstall: () => void;
  onStorePage: () => void;
}

const busy = (job: ModJob | null) => job?.state === "downloading" || job?.state === "installing";

/**
 * An installed game, with the most popular mods for it on GameBanana and a
 * one-click install where the store knows the layout (backend/mods.py).
 *
 * Gamepad: A installs (a mod with several builds asks which first) or, on an
 * installed mod, removes it; B closes (the build question first).
 */
const ModsPanel: FC<Props> = ({ game, onClose, onUninstall, onStorePage }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [info, setInfo] = useState<GameMods | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [job, setJob] = useState<ModJob | null>(null);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  useBackGuard(true, onClose);
  // B on the build question closes only that.
  useBackGuard(choosing !== null, () => {
    const id = choosing;
    setChoosing(null);
    window.requestAnimationFrame(() => focusElement(panelRef.current?.querySelector(`[data-mod="${id}"]`)));
  });

  const load = useCallback(() => {
    getGameMods(game.id)
      .then((value) => {
        setInfo(value);
        setFailed(null);
      })
      .catch((error) => setFailed(String(error)));
  }, [game.id]);

  useEffect(() => {
    load();
    getModJob()
      .then((value) => setJob(busy(value) ? value : null))
      .catch(() => undefined);
  }, [load]);

  // Start on the first mod, or the close button when there are none.
  const loaded = info !== null || failed !== null;
  useEffect(() => {
    if (!loaded) return;
    window.requestAnimationFrame(() =>
      focusElement(panelRef.current?.querySelector(".rs-mod.rs-f") ?? panelRef.current?.querySelector(".rs-close")),
    );
  }, [loaded]);

  // Follow an install while it runs; nothing polls otherwise.
  const running = busy(job);
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      getModJob()
        .then((next) => {
          setJob(next);
          if (next.state === "done") {
            toaster.toast({
              title: "Mod installed",
              body: next.config ? "Custom textures were switched on in Dolphin" : game.title,
              icon: "Check",
            });
            load();
          } else if (next.state === "error") {
            toaster.toast({ title: "Could not install the mod", body: next.error ?? "", icon: "Error" });
          }
        })
        .catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [running, job, load, game.title]);

  const install = (mod: ModInfo, variant: string | null) => {
    setChoosing(null);
    installMod(game.id, mod.id, variant)
      .then((value) => {
        if (value.ok === false && value.error) {
          toaster.toast({ title: "Could not install the mod", body: value.error, icon: "Error" });
          return;
        }
        setJob(value);
      })
      .catch((error) => toaster.toast({ title: "Could not install the mod", body: String(error), icon: "Error" }));
    window.requestAnimationFrame(() => focusElement(panelRef.current?.querySelector(`[data-mod="${mod.id}"]`)));
  };

  const remove = (mod: ModInfo) => {
    setRemoving(mod.id);
    removeMod(game.id, mod.id)
      .then((result) => {
        toaster.toast({
          title: result.ok ? "Mod removed" : "Mod partly removed",
          body: result.error ?? mod.name,
          icon: "Trash",
        });
        load();
      })
      .catch(() => undefined)
      .finally(() => setRemoving(null));
  };

  const activate = (mod: ModInfo) => {
    if (running) return;
    if (mod.installed) remove(mod);
    else if (!mod.installable) return;
    else if (mod.variants.length > 1) {
      setChoosing(mod.id);
      window.requestAnimationFrame(() => focusElement(panelRef.current?.querySelector(".rs-mod-variant")));
    } else install(mod, null);
  };

  const emulators = info?.emulators.map((item) => item.label) ?? [];
  const ready = info?.mods.filter((mod) => mod.installable || mod.installed) ?? [];
  const manual = info?.mods.filter((mod) => !mod.installable && !mod.installed) ?? [];

  const row = (mod: ModInfo) => {
    const mine = job?.mod === mod.id && running;
    const progress = job?.total ? Math.min(1, (job.received ?? 0) / job.total) : 0;
    return (
      <div key={mod.id} className="rs-mod-wrap">
        <Focusable
          noFocusRing
          className={`rs-mod rs-f${mod.installed ? " installed" : ""}${mod.installable || mod.installed ? "" : " manual"}`}
          data-mod={mod.id}
          focusClassName="is-focus"
          onActivate={() => activate(mod)}
          onClick={() => activate(mod)}
          onOKActionDescription={mod.installed ? "Remove" : mod.installable ? "Install" : ""}
        >
          <div className="rs-mod-art">
            {mod.image ? <CoverImage url={mod.image} alt="" /> : <FaPuzzlePiece />}
          </div>
          <div className="rs-mod-main">
            <div className="rs-mod-name">{mod.name}</div>
            <div className="rs-meta">
              {mod.category ? <span>{mod.category}</span> : null}
              <span className="rs-mod-likes">
                <FaHeart /> {mod.likes.toLocaleString()}
              </span>
              {mod.version ? <span>v{mod.version.replace(/^v/i, "")}</span> : null}
              {mod.file.size ? <span>{formatBytes(mod.file.size)}</span> : null}
              {mod.author ? <span>{mod.author}</span> : null}
            </div>
            <div className="rs-mod-summary">
              {mod.installed
                ? `Installed${mod.installed.variant && mod.variants.length > 1 ? ` (${mod.installed.variant})` : ""} for ${mod.installed.emulators
                    .map((id) => info?.emulators.find((e) => e.id === id)?.label ?? id)
                    .join(", ")}`
                : mod.installable
                  ? mod.summary || mod.file.note || ""
                  : mod.reason}
            </div>
          </div>
          <span className="rs-mod-action">
            {mine ? (
              <span className="rs-mod-progress">
                {job?.state === "installing" ? "Installing…" : `${Math.round(progress * 100)}%`}
              </span>
            ) : removing === mod.id ? (
              <Spinner />
            ) : mod.installed ? (
              <span className="rs-mod-state on">
                <FaCheck />
              </span>
            ) : mod.installable ? (
              <span className="rs-mod-state">
                <FaDownload />
              </span>
            ) : null}
          </span>
          {mine ? (
            <span className="rs-mod-bar">
              <Progress value={job?.state === "installing" ? 1 : progress} />
            </span>
          ) : null}
        </Focusable>
        {choosing === mod.id ? (
          <Focusable noFocusRing className="rs-mod-variants" flow-children="row">
            <span className="rs-mod-variants-label">Which version?</span>
            {mod.variants.map((variant) => (
              <Focusable
                noFocusRing
                key={variant}
                className="rs-pill rs-f rs-mod-variant"
                focusClassName="is-focus"
                onActivate={() => install(mod, variant)}
                onClick={() => install(mod, variant)}
                onOKActionDescription="Install this one"
              >
                {variant}
              </Focusable>
            ))}
          </Focusable>
        ) : null}
      </div>
    );
  };

  return (
    <Focusable noFocusRing ref={panelRef} className="rs-modpage" flow-children="column">
      <header className="rs-modpage-head">
        <div className="rs-modpage-art" style={{ aspectRatio: String(Math.min(1.45, Math.max(0.6, boxRatio(game.system)))) }}>
          {game.cover ? <CoverImage url={game.cover} alt="" /> : <NoArt title={game.title} system={game.system} />}
        </div>
        <div className="rs-modpage-title">
          <span className="rs-eyebrow">{systemLabel(game.system)}</span>
          <h1 className="rs-h1" title={game.title}>
            {game.title.replace(/\s*\[[^\]]*\]/g, "").trim() || game.title}
          </h1>
          <div className="rs-meta">
            <span>{formatBytes(game.size)}</span>
            {info?.game_id ? <span>{info.game_id}</span> : null}
            {emulators.length ? <span>Mods go into {emulators.join(" and ")}</span> : null}
          </div>
        </div>
        <Focusable noFocusRing className="rs-modpage-actions" flow-children="row">
          <Button noFocusRing className="rs-btn ghost" onClick={onStorePage}>
            <FaStore /> Store page
          </Button>
          <Button noFocusRing className="rs-btn danger" onClick={onUninstall}>
            <FaTrash /> Uninstall
          </Button>
          <Focusable
            noFocusRing
            className="rs-close rs-f"
            focusClassName="is-focus"
            onActivate={onClose}
            onClick={onClose}
            onOKActionDescription="Close"
          >
            <FaTimes />
          </Focusable>
        </Focusable>
      </header>

      <div className="rs-modpage-body">
        <div className="rs-section-head">
          <h2 className="rs-h2">Popular mods</h2>
          {info?.gamebanana ? <span className="rs-count">GameBanana · {info.gamebanana.name}</span> : null}
          {running ? (
            <Button noFocusRing className="rs-btn ghost rs-mod-cancel" onClick={() => cancelMod().catch(() => undefined)}>
              Cancel install
            </Button>
          ) : null}
        </div>
        {info === null && !failed ? (
          <div className="rs-loading">
            <Spinner /> Looking for mods…
          </div>
        ) : null}
        {failed ? <div className="rs-note warn">Could not load mods: {failed}</div> : null}
        {info?.reason ? <div className="rs-note">{info.reason}</div> : null}
        {ready.length ? (
          <Focusable noFocusRing className="rs-mods" flow-children="column">
            {ready.map(row)}
          </Focusable>
        ) : null}
        {manual.length ? (
          <>
            <h3 className="rs-group">Not one-click</h3>
            <Focusable noFocusRing className="rs-mods" flow-children="column">
              {manual.map(row)}
            </Focusable>
          </>
        ) : null}
        {info && !info.reason && !info.mods.length ? <div className="rs-note">No mods found.</div> : null}
      </div>
    </Focusable>
  );
};

export default ModsPanel;
