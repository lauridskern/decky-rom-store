import { RefObject, useEffect, useRef } from "react";

const MARKER = "romStoreOverlay";
// Each guard gets its own number, so stacked overlays (a screenshot opened from
// the game panel) can tell whose history entry the back button removed.
let nextGuardId = 1;
// History entries outlive a reload of the page or the plugin, the numbering
// does not. Entries are tagged with this load's token, so a stale entry with a
// higher number is never mistaken for a newer overlay still being open.
const SESSION_KEY = "romStoreSession";
const SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Entry = Record<string, unknown> | null;

const ours = (state: Entry): number | null =>
  state?.[SESSION_KEY] === SESSION && typeof state?.[MARKER] === "number" ? (state[MARKER] as number) : null;

// Entries whose overlay has closed without the back button (its X, a tab
// switch) and that are still in the history. They are popped once they are on
// top - right away as a rule, later if a newer overlay sits on them.
const stale = new Set<number>();
let sweeping = false;

function sweep(): void {
  try {
    const top = ours(window.history.state as Entry);
    if (top !== null && stale.has(top)) {
      stale.delete(top);
      window.history.back(); // fires popstate, which sweeps again
    }
  } catch {
    /* ignore */
  }
}

/**
 * Makes the Steam Deck's back button work inside the plugin.
 *
 * The B button pops the Steam client's history. Our views (the game page, a
 * tab, a result list) are not routes of their own, so B would leave the
 * plugin completely. This pushes a history entry while such a view is open;
 * pressing B then pops that entry, the view closes and the plugin stays
 * where it was. With nothing open, B leaves the plugin as usual.
 *
 * Guards stack: with the game page and a screenshot open, B closes only the
 * screenshot, because the page's own entry is still in the history.
 *
 * One view may close while another opens in the same moment (the game page
 * hands over to the Downloads tab). The new one then takes over the old
 * one's entry instead of pushing its own: popping the old entry afterwards
 * would remove the new one and close what just opened.
 */
export function useBackGuard(open: boolean, onClose: () => void): void {
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const id = nextGuardId++;
    const state = { [MARKER]: id, [SESSION_KEY]: SESSION };
    pushed.current = true;
    try {
      const top = ours(window.history.state as Entry);
      if (top !== null && stale.has(top)) {
        stale.delete(top);
        window.history.replaceState(state, "");
      } else {
        window.history.pushState(state, "");
      }
    } catch {
      pushed.current = false;
      return;
    }
    if (!sweeping) {
      sweeping = true;
      window.addEventListener("popstate", sweep);
    }

    const onPop = (event: PopStateEvent) => {
      if (!pushed.current) return;
      // A later overlay's entry was popped and ours is still current.
      const current = ours(event.state as Entry);
      if (current !== null && current >= id) return;
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
        stale.add(id);
        // Defer it: doing this while React is unmounting the overlay makes
        // the whole Steam client re-render at the worst possible moment.
        window.setTimeout(sweep, 0);
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
