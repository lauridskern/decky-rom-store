import { RefObject, useEffect, useRef } from "react";

const MARKER = "romStoreOverlay";

/**
 * Makes the Steam Deck's back button work inside the plugin.
 *
 * The B button pops the Steam client's history. Our overlay views (the game
 * details, the settings) are not routes of their own, so B would leave the
 * plugin completely. This pushes a history entry while an overlay is open;
 * pressing B then pops that entry, the overlay closes and the plugin stays
 * where it was. Pressing B again leaves the plugin as usual.
 */
export function useBackGuard(open: boolean, onClose: () => void): void {
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    pushed.current = true;
    try {
      window.history.pushState({ [MARKER]: true }, "");
    } catch {
      pushed.current = false;
      return;
    }

    const onPop = () => {
      if (!pushed.current) return;
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
        try {
          window.history.back();
        } catch {
          /* ignore */
        }
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
