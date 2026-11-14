import { RefObject, useEffect, useRef } from "react";

/**
 * The Steam client draws a header bar over the top of the window and a hint
 * bar at the bottom, both of which sit on top of plugin content. Their height
 * differs between Game Mode and Desktop Mode, so instead of hard coding it we
 * hit test the DOM: the first pixel from the top where our own content is the
 * topmost element is exactly where the Steam header ends.
 */
export function useChromeInsets(): RefObject<HTMLDivElement | null> {
  const holder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = () => {
      const element = holder.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      // Steam exposes the height of its own header bar. If it is there we
      // use it, otherwise we measure where our content becomes visible.
      const steamHeader = getComputedStyle(document.documentElement)
        .getPropertyValue("--basicui-header-height")
        .trim();
      const headerFromSteam = parseFloat(steamHeader);

      const x = Math.round(rect.left + Math.min(rect.width, 600) / 2);
      const limit = Math.min(window.innerHeight, Math.max(rect.bottom, rect.top + 1));

      let measuredTop = 0;
      for (let y = Math.max(0, Math.floor(rect.top)); y < limit; y += 2) {
        const hit = document.elementFromPoint(x, y);
        if (hit && element.contains(hit)) {
          measuredTop = Math.max(0, y - rect.top);
          break;
        }
      }

      let bottom = 0;
      for (let y = window.innerHeight - 1; y > rect.top; y -= 2) {
        const hit = document.elementFromPoint(x, y);
        if (hit && element.contains(hit)) {
          bottom = Math.max(0, rect.bottom - y);
          break;
        }
      }

      const top = Number.isFinite(headerFromSteam) && headerFromSteam > 0 ? headerFromSteam : measuredTop;

      if (top > 0) element.style.setProperty("--rs-chrome-top", `${top}px`);
      if (bottom > 0) element.style.setProperty("--rs-chrome-bottom", `${bottom}px`);
    };

    // The Steam chrome animates in, so measure again shortly after mounting.
    measure();
    const timers = [
      window.setTimeout(measure, 250),
      window.setTimeout(measure, 900),
      window.setTimeout(measure, 2000),
    ];
    window.addEventListener("resize", measure);
    const interval = window.setInterval(measure, 2000);

    return () => {
      timers.forEach(window.clearTimeout);
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return holder;
}
