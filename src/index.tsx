import { useEffect, useState } from "react";
import { addEventListener, definePlugin, removeEventListener, routerHook, toaster } from "@decky/api";
import { ButtonItem, Navigation, PanelSection, PanelSectionRow, staticClasses, TextField } from "@decky/ui";
import { FaStore } from "react-icons/fa";

import StoreHost from "./components/StoreHost";
import { injectStyles } from "./styles";
import { requestSearch } from "./state";
import { DownloadJob, getDownloads, getStatus } from "./types";
import { reportSteamRomManager, syncWithSteam } from "./steam";
import StoreStyles from "./components/StoreStyles";
import ErrorBoundary from "./components/ErrorBoundary";

const StoreRoute = StoreHost;

function PanelContent() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getStatus>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getDownloads()
        .then((jobs) => {
          if (!cancelled) {
            setActive(jobs.filter((job) => job.status === "downloading" || job.status === "queued").length);
          }
        })
        .catch(() => undefined);
    const refreshStatus = () =>
      getStatus()
        .then((value) => {
          if (!cancelled) setStatus(value);
        })
        .catch(() => undefined);
    refresh();
    refreshStatus();
    const timer = setInterval(refresh, 2000);
    const statusTimer = setInterval(refreshStatus, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(statusTimer);
    };
  }, []);

  const open = () => {
    requestSearch(query.trim());
    Navigation.Navigate("/rom-store");
    Navigation.CloseSideMenus();
  };

  return (
    <>
      <StoreStyles />
      <ErrorBoundary label="menu">
        <PanelSection title="ROM Store">
        <PanelSectionRow>
          <div style={{ display: "flex", gap: "8px", width: "100%", alignItems: "center" }}>
            <TextField
              label="Search games"
              value={query}
              placeholder="Games, consoles or regions…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") open();
              }}
            />
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={open}>
            Open the store
          </ButtonItem>
        </PanelSectionRow>
          {active > 0 && (
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={open}>
                {active} download{active === 1 ? "" : "s"} in progress
              </ButtonItem>
            </PanelSectionRow>
          )}
          {status && (
            <PanelSectionRow>
              <div style={{ fontSize: "11px", color: "#8f98a0", lineHeight: 1.6, width: "100%" }}>
                <div>ROM library: {status.library.root || "not found"}</div>
                <div>
                  Sources:{" "}
                  {status.sources
                    .filter((source) => source.enabled)
                    .map((source) => source.id)
                    .join(", ")}
                </div>
                {status.sources
                  .filter((source) => source.enabled && source.error)
                  .map((source) => (
                    <div key={source.id} style={{ color: "#ff8f6b" }}>
                      {source.id}: {source.error}
                    </div>
                  ))}
              </div>
            </PanelSectionRow>
          )}
        </PanelSection>
      </ErrorBoundary>
    </>
  );
}

/**
 * A finished download goes straight into the Steam library. The backend sends
 * the event, so this works while the store page is closed.
 */
const onDownloadDone = (job: DownloadJob) => {
  const paths = [job.path, job.extracted_to].filter((path): path is string => Boolean(path));
  if (!paths.length) return;
  syncWithSteam(paths)
    .then((result) => {
      if (result.added.length || result.adopted.length) {
        toaster.toast({ title: "Added to your Steam library", body: [...result.added, ...result.adopted].join(", "), icon: "Steam" });
      } else if (Object.keys(result.missing).length && result.ok) {
        toaster.toast({
          title: "Not added to Steam",
          body: "Steam ROM Manager has no parser for this console. Sync again after setting one up.",
          icon: "Steam",
        });
      }
    })
    .catch(() => undefined);
};

/**
 * Emu Hub changed which emulator opens a console's games (it switches Steam
 * ROM Manager's parsers and sends this DOM event; both plugins share Steam's
 * page). A sync re-points the shortcuts the store manages. Keep the event
 * name in step with Emu Hub's src/choice.ts.
 */
const EMULATOR_CHOICE_EVENT = "emuhub:emulator-choice";
const onEmulatorChoice = (event: Event) => {
  const detail = (event as CustomEvent<{ console?: string; emulator?: string }>).detail ?? {};
  syncWithSteam()
    .then((result) => {
      if (!result.repointed.length) return;
      toaster.toast({
        title: `${result.repointed.length} game${result.repointed.length === 1 ? "" : "s"} now open in ${detail.emulator ?? "the new emulator"}`,
        body: "Steam shortcuts updated by ROM Store.",
        icon: "Steam",
      });
    })
    .catch(() => undefined);
};

export default definePlugin(() => {
  injectStyles();
  window.addEventListener(EMULATOR_CHOICE_EVENT, onEmulatorChoice);
  addEventListener<[DownloadJob]>("rom_store_download_done", onDownloadDone);
  // Steam ROM Manager may have run while Steam was closed: report and adopt.
  reportSteamRomManager((title, body) => toaster.toast({ title, body, icon: "Steam" })).catch(() => undefined);

  routerHook.addRoute("/rom-store", StoreRoute, { exact: true });

  return {
    name: "ROM Store",
    titleView: <div className={staticClasses.Title}>ROM Store</div>,
    content: <PanelContent />,
    icon: <FaStore />,
    onDismount() {
      removeEventListener("rom_store_download_done", onDownloadDone);
      window.removeEventListener(EMULATOR_CHOICE_EVENT, onEmulatorChoice);
      routerHook.removeRoute("/rom-store");
    },
  };
});
