import { RefObject, useEffect, useRef } from "react";

/**
 * The Steam client draws a header bar over the top of the window and a button
 * bar over the bottom, both of which sit on top of plugin content.
 *
 * The header height is published by Steam itself as
 * `--basicui-header-height`. There is no official variable for the bottom
 * bar, so we look for any variable that mentions "footer" and fall back to
 * measuring the DOM (hit testing where our own content stops being the
 * topmost element).
 *
 * Both values can be overridden from the plugin settings.
 */
function steamVariable(pattern: RegExp): number {
  if (typeof document === "undefined") return 0;
  const styles = getComputedStyle(document.documentElement);
  const found: number[] = [];
  for (const property of Array.from(styles)) {
    if (!property.startsWith("--")) continue;
    if (!pattern.test(property)) continue;
    const value = parseFloat(styles.getPropertyValue(property));
    if (Number.isFinite(value) && value > 0) found.push(value);
  }
  return found.length ? Math.max(...found) : 0;
}

export function useChromeInsets(manualTop = 0, manualBottom = 0): RefObject<HTMLDivElement | null> {
  const holder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = () => {
      const element = holder.current;
      if (!element) return;

      const headerFromSteam = steamVariable(/header/i);
      const footerFromSteam = steamVariable(/footer|bottom-bar|button-bar/i);

      let measuredTop = 0;
      if (!headerFromSteam) {
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + Math.min(rect.width, 600) / 2);
        const limit = Math.min(window.innerHeight, Math.max(rect.bottom, rect.top + 1));
        for (let y = Math.max(0, Math.floor(rect.top)); y < limit; y += 2) {
          const hit = document.elementFromPoint(x, y);
          if (hit && element.contains(hit)) {
            measuredTop = Math.max(0, y - rect.top);
            break;
          }
        }
      }

      // Steam does not always publish these, so fall back to a sensible
      // default instead of ending up under the chrome.
      const top = manualTop > 0 ? manualTop : (headerFromSteam || measuredTop || 40);
      const bottom = manualBottom > 0 ? manualBottom : (footerFromSteam || 40);

      element.style.setProperty("--rs-chrome-top", `${top}px`);
      element.style.setProperty("--rs-chrome-bottom", `${bottom}px`);
    };

    // The Steam chrome animates in, so measure again shortly after mounting.
    measure();
    const timers = [
      window.setTimeout(measure, 250),
      window.setTimeout(measure, 900),
      window.setTimeout(measure, 2000),
    ];
    // No polling: every measurement walks Steam's own CSS variables and, in
    // the fallback path, hit-tests the DOM - both force a style/layout flush,
    // which is expensive to do on a timer inside the Steam client.
    window.addEventListener("resize", measure);

    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener("resize", measure);
    };
  }, [manualTop, manualBottom]);

  return holder;
}
