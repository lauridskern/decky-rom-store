import { useEffect, useState } from "react";
import { definePlugin, routerHook } from "@decky/api";
import { ButtonItem, Navigation, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { FaStore } from "react-icons/fa";

import Store from "./components/Store";
import { injectStyles } from "./styles";
import { requestSearch } from "./state";
import logo from "virtual:logo";

const StoreRoute = () => <Store />;

function PanelContent() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    import("./types").then(({ getDownloads }) =>
      getDownloads()
        .then((jobs) => {
          if (!cancelled) {
            setActive(jobs.filter((job) => job.status === "downloading" || job.status === "queued").length);
          }
        })
        .catch(() => undefined),
    );
    const timer = setInterval(() => {
      import("./types").then(({ getDownloads }) =>
        getDownloads()
          .then((jobs) => {
            if (!cancelled) {
              setActive(jobs.filter((job) => job.status === "downloading" || job.status === "queued").length);
            }
          })
          .catch(() => undefined),
      );
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const open = () => {
    requestSearch(query.trim());
    Navigation.Navigate("/rom-store");
    Navigation.CloseSideMenus();
  };

  return (
    <>
      <PanelSection title="ROM Store">
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "center", width: "100%", marginBottom: "4px" }}>
            <img src={logo} alt="ROM Store" style={{ width: "84px", borderRadius: "16px" }} />
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ display: "flex", gap: "8px", width: "100%", alignItems: "center" }}>
            <input
              type="text"
              value={query}
              placeholder="Search games…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") open();
              }}
              style={{
                flex: "1 1 auto",
                padding: "6px 8px",
                borderRadius: "4px",
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(0,0,0,0.3)",
                color: "#fff",
                fontSize: "13px",
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
      </PanelSection>
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
