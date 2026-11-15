import { RefObject, useEffect, useRef } from "react";

const MARKER = "romStoreOverlay";
// Each guard gets its own number, so stacked overlays (a screenshot opened from
// the game panel) can tell whose history entry the back button removed.
let nextGuardId = 1;

/**
 * Makes the Steam Deck's back button work inside the plugin.
 *
 * The B button pops the Steam client's history. Our overlay views (the game
 * details, the settings) are not routes of their own, so B would leave the
 * plugin completely. This pushes a history entry while an overlay is open;
 * pressing B then pops that entry, the overlay closes and the plugin stays
 * where it was. Pressing B again leaves the plugin as usual.
 *
 * Guards stack: with the game panel and a screenshot open, B closes only the
 * screenshot, because the panel's own entry is still in the history.
 */
export function useBackGuard(open: boolean, onClose: () => void): void {
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const id = nextGuardId++;
    pushed.current = true;
    try {
      window.history.pushState({ [MARKER]: id }, "");
    } catch {
      pushed.current = false;
      return;
    }

    const onPop = (event: PopStateEvent) => {
      if (!pushed.current) return;
      // A later overlay's entry was popped and ours is still current.
      const current = (event.state as Record<string, unknown> | null)?.[MARKER];
      if (typeof current === "number" && current >= id) return;
      // The user pressed back: our entry is consumed, close the overlay and
      // leave the history alone so the next press leaves the plugin.
      pushed.current = false;
      closeRef.current();
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) {
        pushed.current = false;
        // Defer it: doing this while React is unmounting the overlay makes
        // the whole Steam client re-render at the worst possible moment.
        window.setTimeout(() => {
          try {
            window.history.back();
          } catch {
            /* ignore */
          }
        }, 0);
      }
    };
  }, [open]);
}

/** True when the plugin is on top of the Steam client's history. */
export function useCanGoBack(): RefObject<boolean> {
  const can = useRef(false);
  useEffect(() => {
    can.current = window.history.length > 1;
  }, []);
  return can;
}
