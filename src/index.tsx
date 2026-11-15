import { useEffect, useState } from "react";
import { definePlugin, routerHook } from "@decky/api";
import { ButtonItem, Navigation, PanelSection, PanelSectionRow, staticClasses, TextField } from "@decky/ui";
import { FaStore } from "react-icons/fa";

import StoreHost from "./components/StoreHost";
import { injectStyles } from "./styles";
import { requestSearch } from "./state";
import { getDownloads, getStatus } from "./types";
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

export default definePlugin(() => {
  injectStyles();

  routerHook.addRoute("/rom-store", StoreRoute, { exact: true });

  return {
    name: "ROM Store",
    titleView: <div className={staticClasses.Title}>ROM Store</div>,
    content: <PanelContent />,
    icon: <FaStore />,
    onDismount() {
      routerHook.removeRoute("/rom-store");
    },
  };
});
