import type { GamepadEvent, NavEntryPositionPreferences } from "@decky/ui";

/**
 * Gamepad helpers for Steam's focus engine.
 *
 * How navigation works in the Steam client: every `Focusable` (and every
 * `Button`, `TextField`, `Dropdown`) is a node in a navigation tree. A node's
 * `flow-children` decides how the d-pad moves between its children:
 *
 *   "row"     left/right step through the children, up/down leave the group
 *   "column"  up/down step through the children, left/right leave the group
 *   "grid"    all four directions, picked by where the children are on screen
 *
 * A container without `flow-children` lets every direction step to the next or
 * previous child in order, which is how "left" ended up meaning "up" in the
 * grid. Every container that holds more than one focusable needs a layout.
 *
 * Plain DOM elements (<button>, <input>, a clickable <div>) are not part of the
 * tree and cannot be reached with the d-pad at all.
 */

/** Steam's button ids (`GamepadButton` in @decky/ui), spelled out so the
 *  preview harness, which stubs @decky/ui, needs nothing extra at runtime. */
export const PAD = {
  OK: 1,
  CANCEL: 2,
  SECONDARY: 3, // X
  OPTIONS: 4, // Y
  BUMPER_LEFT: 5,
  BUMPER_RIGHT: 6,
  DIR_UP: 9,
  DIR_DOWN: 10,
  DIR_LEFT: 11,
  DIR_RIGHT: 12,
} as const;

/** Enter a group at the child nearest to where focus came from horizontally. */
export const ENTER_KEEP_X = 2 as NavEntryPositionPreferences;

/**
 * Steam's focus engine takes `childFocusDisabled` on a Focusable, the @decky/ui
 * typings do not list it. Used to keep the d-pad out of the store behind an
 * open overlay.
 */
export const childFocus = (enabled: boolean) => ({ childFocusDisabled: !enabled }) as object;

/** Move gamepad focus to an element. Steam follows the browser's focus. */
export function focusElement(element: Element | null | undefined): boolean {
  if (!element || !(element as HTMLElement).isConnected) return false;
  (element as HTMLElement).focus();
  return true;
}

/** Focus the first match after the next paint (the element may not exist yet). */
export function focusSoon(root: ParentNode | null | undefined, selector: string): void {
  window.requestAnimationFrame(() => {
    focusElement(root?.querySelector(selector));
  });
}

/** Swallows a d-pad press so focus does not move. */
export function stopNav(event: GamepadEvent): void {
  event.preventDefault?.();
  event.stopPropagation?.();
}
