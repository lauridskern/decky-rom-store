/**
 * Minimal stand-in for @decky/ui so the store can be rendered outside of the
 * Steam client (the real package reaches into Decky's webpack globals).
 *
 * It also emulates the parts of Steam's gamepad focus engine the store relies
 * on, so controller navigation can be tried in a browser:
 *
 *   arrow keys / d-pad      move focus (honours `flow-children`)
 *   Enter / A               OK          (onActivate, onOKButton, click)
 *   Escape, Backspace / B   back        (onCancelButton, else history.back())
 *   X, Y                    onSecondaryButton, onOptionsButton
 *   Q / E, L1 / R1          bumpers     (onButtonDown)
 *   Z / C, L2 / R2          triggers    (onButtonDown)
 *
 * A real controller works too (the browser's Gamepad API, standard mapping).
 * The focused element's button hints are sent to the Deck frame's bottom bar
 * as a `rs-legend` event, like the Steam client's own button bar.
 *
 * Layouts, as in Steam: "row" moves left/right, "column" up/down, "grid" and
 * "geometric" in all directions by position. A container WITHOUT a layout lets
 * every direction step through its children in order, the same quirk the
 * Steam client has, so a missing `flow-children` shows up here too.
 * This is an approximation for trying flows, not a copy of Steam's engine.
 */
import { forwardRef, HTMLAttributes, ReactNode, useEffect, useRef } from "react";

// --------------------------------------------------------------- nav engine

const BTN = { OK: 1, CANCEL: 2, SECONDARY: 3, OPTIONS: 4, BUMPER_LEFT: 5, BUMPER_RIGHT: 6, TRIGGER_LEFT: 7, TRIGGER_RIGHT: 8, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12 };
type Dir = "up" | "down" | "left" | "right";
const DIR_BTN: Record<Dir, number> = { up: BTN.DIR_UP, down: BTN.DIR_DOWN, left: BTN.DIR_LEFT, right: BTN.DIR_RIGHT };

type NavProps = Record<string, any>;
type NavEl = HTMLElement & { __nav?: NavProps; __last?: HTMLElement };

const navOf = (el: Element | null): NavProps => ((el as NavEl | null)?.__nav ?? {}) as NavProps;

/** Keeps the latest props on the element, where the engine reads them. */
function useNavProps<T extends HTMLElement>(props: NavProps, outer?: any) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    (el as NavEl).__nav = props;
    // A re-render rewrites className: the focus classes follow real focus.
    const focused = el === document.activeElement;
    el.classList.toggle("gpfocus", focused);
    if (props.focusClassName) el.classList.toggle(props.focusClassName, focused);
  });
  return (el: T | null) => {
    ref.current = el;
    if (el) (el as NavEl).__nav = props;
    if (typeof outer === "function") outer(el);
    else if (outer) outer.current = el;
  };
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const isTarget = (el: Element) =>
  (el as HTMLElement).dataset.nav === "target" &&
  !(el as HTMLButtonElement).disabled &&
  !el.closest("[data-nav-off]") &&
  visible(el);
const navParent = (el: Element): HTMLElement | null =>
  (el.parentElement?.closest('[data-nav="container"]') as HTMLElement | null) ?? null;
const targetsIn = (node: Element): HTMLElement[] =>
  (node as HTMLElement).dataset.nav === "target"
    ? isTarget(node) ? [node as HTMLElement] : []
    : node.closest("[data-nav-off]")
      ? []
      : (Array.from(node.querySelectorAll('[data-nav="target"]')).filter(isTarget) as HTMLElement[]);
const navChildren = (parent: HTMLElement | null): HTMLElement[] =>
  (Array.from((parent ?? document).querySelectorAll("[data-nav]")) as HTMLElement[]).filter(
    (el) => navParent(el) === parent && targetsIn(el).length > 0,
  );
const ancestors = (el: Element): HTMLElement[] => {
  const out: HTMLElement[] = [];
  for (let p = navParent(el); p; p = navParent(p)) out.push(p);
  return out;
};
const current = (): HTMLElement | null => {
  const active = document.activeElement as HTMLElement | null;
  return active && active.dataset?.nav === "target" ? active : null;
};

function gamepadEvent(button: number) {
  return new CustomEvent("vgp_button", { detail: { button, source: 0 }, cancelable: true });
}

/** The closest candidate in a direction, by position. */
function nearest(from: DOMRect, candidates: HTMLElement[], dir: Dir | null): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let primary = 0;
    let secondary = 0;
    if (dir === "right") { if (r.left < from.right - 2) continue; primary = r.left - from.right; secondary = Math.abs(y - cy); }
    else if (dir === "left") { if (r.right > from.left + 2) continue; primary = from.left - r.right; secondary = Math.abs(y - cy); }
    else if (dir === "down") { if (r.top < from.bottom - 2) continue; primary = r.top - from.bottom; secondary = Math.abs(x - cx); }
    else if (dir === "up") { if (r.bottom > from.top + 2) continue; primary = from.top - r.bottom; secondary = Math.abs(x - cx); }
    else { primary = Math.hypot(x - cx, y - cy); }
    const score = primary + secondary * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/** Picks the sibling to move to inside a parent with the given layout. */
function pick(layout: string, siblings: HTMLElement[], child: HTMLElement, dir: Dir, from: DOMRect): HTMLElement | null {
  const i = siblings.indexOf(child);
  const vertical = dir === "up" || dir === "down";
  const forward = dir === "down" || dir === "right";
  const step = (reverse: boolean) => siblings[i + ((forward !== reverse) ? 1 : -1)] ?? null;
  switch (layout) {
    case "row": return vertical ? null : step(false);
    case "row-reverse": return vertical ? null : step(true);
    case "column": return vertical ? step(false) : null;
    case "column-reverse": return vertical ? step(true) : null;
    case "grid":
    case "geometric":
      return nearest(from, siblings.filter((s) => s !== child), dir);
    default:
      // No layout: every direction walks the children in order (Steam does the same).
      return step(false);
  }
}

/** Enters a node: its last focused target, a preferred one, or the nearest. */
function enter(node: HTMLElement, from: DOMRect) {
  const targets = targetsIn(node);
  const last = (node as NavEl).__last;
  const preferred = targets.find((t) => navOf(t).preferredFocus);
  const chosen = (last && targets.includes(last) ? last : null) ?? preferred ?? nearest(from, targets, null) ?? targets[0];
  chosen?.focus();
}

function move(dir: Dir) {
  const from = current();
  if (!from) {
    const first = targetsIn(document.body)[0];
    first?.focus();
    return;
  }
  // Direction handlers first, focused element outwards (onGamepadDirection).
  const event = gamepadEvent(DIR_BTN[dir]);
  for (const el of [from, ...ancestors(from)]) {
    navOf(el).onGamepadDirection?.(event);
    if (event.defaultPrevented || (event as any).cancelBubble) return;
  }
  const rect = from.getBoundingClientRect();
  let child: HTMLElement = from;
  let parent = navParent(from);
  for (;;) {
    const layout = parent ? (parent.dataset.flow ?? "none") : "column";
    const next = pick(layout, navChildren(parent), child, dir, rect);
    if (next) {
      enter(next, rect);
      return;
    }
    if (!parent) return;
    child = parent;
    parent = navParent(parent);
  }
}

function press(button: number) {
  const focused = current();
  const chain = focused ? [focused, ...ancestors(focused)] : [];
  const event = gamepadEvent(button);
  for (const el of chain) {
    navOf(el).onButtonDown?.(event);
    if (event.defaultPrevented) return;
  }
  const first = (name: string) => chain.find((el) => typeof navOf(el)[name] === "function");
  if (button === BTN.OK && focused) {
    const nav = navOf(focused);
    if (nav.onOKButton) nav.onOKButton(event);
    else if (nav.onActivate) nav.onActivate(event);
    else if (focused instanceof HTMLSelectElement) {
      // A Steam dropdown opens a menu; here A steps to the next option.
      focused.selectedIndex = (focused.selectedIndex + 1) % Math.max(1, focused.options.length);
      focused.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (!(focused instanceof HTMLInputElement)) focused.click();
  } else if (button === BTN.CANCEL) {
    const handler = first("onCancelButton") ?? first("onCancel");
    if (handler) (navOf(handler).onCancelButton ?? navOf(handler).onCancel)(event);
    else window.history.back();
  } else if (button === BTN.SECONDARY) {
    const handler = first("onSecondaryButton");
    if (handler) navOf(handler).onSecondaryButton(event);
  } else if (button === BTN.OPTIONS) {
    const handler = first("onOptionsButton");
    if (handler) navOf(handler).onOptionsButton(event);
  }
  window.setTimeout(emitLegend, 50);
}

// ------------------------------------------------------------- button hints

const LABEL: Record<number, string> = { [BTN.OK]: "A", [BTN.CANCEL]: "B", [BTN.SECONDARY]: "X", [BTN.OPTIONS]: "Y", [BTN.BUMPER_LEFT]: "L1", [BTN.BUMPER_RIGHT]: "R1", [BTN.TRIGGER_LEFT]: "L2", [BTN.TRIGGER_RIGHT]: "R2" };
const DESCRIPTION: Record<number, string> = {
  [BTN.OK]: "onOKActionDescription",
  [BTN.CANCEL]: "onCancelActionDescription",
  [BTN.SECONDARY]: "onSecondaryActionDescription",
  [BTN.OPTIONS]: "onOptionsActionDescription",
};

function emitLegend() {
  const focused = current();
  const chain = focused ? [focused, ...ancestors(focused)] : [];
  const found = new Map<number, string>();
  for (const el of chain) {
    const nav = navOf(el);
    for (const [button, key] of Object.entries(DESCRIPTION)) {
      const b = Number(button);
      if (!found.has(b) && nav[key]) found.set(b, String(nav[key]));
    }
    for (const [button, text] of Object.entries(nav.actionDescriptionMap ?? {})) {
      const b = Number(button);
      if (!found.has(b) && text) found.set(b, String(text));
    }
  }
  if (focused && !found.has(BTN.OK)) found.set(BTN.OK, "Select");
  if (!found.has(BTN.CANCEL)) found.set(BTN.CANCEL, "Back");
  const order = [BTN.TRIGGER_LEFT, BTN.TRIGGER_RIGHT, BTN.BUMPER_LEFT, BTN.BUMPER_RIGHT, BTN.OPTIONS, BTN.SECONDARY, BTN.CANCEL, BTN.OK];
  const legend = order.filter((b) => found.has(b)).map((b) => ({ button: LABEL[b], label: found.get(b)! }));
  window.dispatchEvent(new CustomEvent("rs-legend", { detail: legend }));
}

// ------------------------------------------------------------------ inputs

const KEYS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

function installEngine() {
  if ((window as any).__rsNavEngine) return;
  (window as any).__rsNavEngine = true;

  document.addEventListener(
    "keydown",
    (event) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const dir = KEYS[event.key];
      let button: number | null = null;
      if (event.key === "Enter") button = BTN.OK;
      else if (event.key === "Escape" || (event.key === "Backspace" && !typing)) button = BTN.CANCEL;
      else if (!typing && !event.metaKey && !event.ctrlKey) {
        const k = event.key.toLowerCase();
        if (k === "x") button = BTN.SECONDARY;
        else if (k === "y") button = BTN.OPTIONS;
        else if (k === "q" || k === "[") button = BTN.BUMPER_LEFT;
        else if (k === "e" || k === "]") button = BTN.BUMPER_RIGHT;
        else if (k === "z") button = BTN.TRIGGER_LEFT;
        else if (k === "c") button = BTN.TRIGGER_RIGHT;
      }
      if (!dir && button === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (dir) move(dir);
      else press(button!);
    },
    true,
  );

  // Focus classes, last-focused memory and onGamepadFocus, as Steam does.
  let marked: HTMLElement | null = null;
  const markFocus = (el: HTMLElement) => {
    if (el?.dataset?.nav !== "target" || el === marked) return;
    marked = el;
    const nav = navOf(el);
    // Exactly one element carries the focus look, as in Steam.
    document.querySelectorAll(".gpfocus").forEach((other) => {
      if (other === el) return;
      other.classList.remove("gpfocus");
      const cls = navOf(other).focusClassName;
      if (cls) other.classList.remove(cls);
    });
    el.classList.add("gpfocus");
    if (nav.focusClassName) el.classList.add(nav.focusClassName);
    for (const parent of ancestors(el)) (parent as NavEl).__last = el;
    nav.onGamepadFocus?.(gamepadEvent(0));
    emitLegend();
  };
  document.addEventListener("focusin", (event) => markFocus(event.target as HTMLElement));
  // Chrome holds back focus events while its window is not focused (a pane
  // driven by scripts); focus() itself still moves focus, so mark it there.
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    focus.call(this, options);
    if (document.activeElement === this) markFocus(this);
  };
  document.addEventListener("focusout", (event) => {
    const el = event.target as HTMLElement;
    if (el?.dataset?.nav !== "target") return;
    if (marked === el) marked = null;
    el.classList.remove("gpfocus");
    const nav = navOf(el);
    if (nav.focusClassName) el.classList.remove(nav.focusClassName);
    window.setTimeout(emitLegend, 0);
  });
  window.setInterval(emitLegend, 700);

  // A real controller through the Gamepad API (standard mapping).
  const PAD_BUTTONS: Record<number, number | Dir> = {
    0: BTN.OK, 1: BTN.CANCEL, 2: BTN.SECONDARY, 3: BTN.OPTIONS, 4: BTN.BUMPER_LEFT, 5: BTN.BUMPER_RIGHT,
    6: BTN.TRIGGER_LEFT, 7: BTN.TRIGGER_RIGHT,
    12: "up", 13: "down", 14: "left", 15: "right",
  };
  const held = new Map<string, number>();
  let polling = false;
  const poll = () => {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find(Boolean);
    if (!pad) { polling = false; return; }
    const now = performance.now();
    const fire = (key: string, down: boolean, action: () => void, repeat: boolean) => {
      const since = held.get(key);
      if (!down) { held.delete(key); return; }
      if (since === undefined) { held.set(key, now + 380); action(); }
      else if (repeat && now >= since) { held.set(key, now + 110); action(); }
    };
    for (const [index, action] of Object.entries(PAD_BUTTONS)) {
      const down = Boolean(pad.buttons[Number(index)]?.pressed);
      fire(`b${index}`, down, () => (typeof action === "string" ? move(action) : press(action)), typeof action === "string");
    }
    const [ax = 0, ay = 0] = pad.axes;
    fire("sx-", ax < -0.6, () => move("left"), true);
    fire("sx+", ax > 0.6, () => move("right"), true);
    fire("sy-", ay < -0.6, () => move("up"), true);
    fire("sy+", ay > 0.6, () => move("down"), true);
    window.requestAnimationFrame(poll);
  };
  window.addEventListener("gamepadconnected", () => {
    if (!polling) { polling = true; window.requestAnimationFrame(poll); }
  });
}
installEngine();

// --------------------------------------------------------------- components

const NAV_KEYS = [
  "flow-children", "focusClassName", "focusWithinClassName", "noFocusRing", "onActivate", "onCancel",
  "navEntryPreferPosition", "preferredFocus", "actionDescriptionMap", "onOKActionDescription",
  "onCancelActionDescription", "onSecondaryActionDescription", "onOptionsActionDescription",
  "onMenuActionDescription", "onButtonDown", "onButtonUp", "onOKButton", "onCancelButton",
  "onSecondaryButton", "onOptionsButton", "onGamepadDirection", "onGamepadFocus", "onGamepadBlur",
  "onMenuButton", "childFocusDisabled", "focusable", "autoFocus",
];

/** Splits Steam's navigation props from the DOM props. */
function split(props: Record<string, any>) {
  const nav: NavProps = {};
  const dom: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) (NAV_KEYS.includes(key) ? nav : dom)[key] = value;
  return { nav, dom };
}

interface FocusableProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  [key: string]: any;
}

export const Focusable = forwardRef<HTMLDivElement, FocusableProps>(({ children, ...props }, outer) => {
  const { nav, dom } = split(props);
  // Like Steam: a Focusable that does something is a target, otherwise a group.
  const target = nav.focusable ?? Boolean(nav.onActivate || dom.onClick);
  const ref = useNavProps<HTMLDivElement>({ ...nav, onClick: dom.onClick }, outer);
  return (
    <div
      {...dom}
      ref={ref}
      data-nav={target ? "target" : "container"}
      data-flow={nav["flow-children"]}
      data-nav-off={nav.childFocusDisabled ? "" : undefined}
      tabIndex={target ? 0 : dom.tabIndex}
    >
      {children}
    </div>
  );
});

interface DropdownProps {
  rgOptions?: { label: ReactNode; data: any }[];
  selectedOption?: any;
  onChange?: (option: { label: ReactNode; data: any }) => void;
  menuLabel?: string;
  disabled?: boolean;
}

export const Dropdown = ({ rgOptions = [], selectedOption, onChange, menuLabel, disabled }: DropdownProps) => {
  const ref = useNavProps<HTMLSelectElement>({ onOKActionDescription: menuLabel ? `Choose ${menuLabel.toLowerCase()}` : "Choose" });
  return (
    <select
      ref={ref}
      data-nav="target"
      disabled={disabled}
      value={selectedOption}
      onChange={(event) => {
        const found = rgOptions.find((option) => String(option.data) === event.target.value);
        if (found) onChange?.(found);
      }}
    >
      {rgOptions.map((option) => (
        <option key={String(option.data)} value={option.data}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onKeyDown?: (event: any) => void;
  disabled?: boolean;
}

export const TextField = ({ label, value, placeholder, onChange, onKeyDown }: TextFieldProps) => {
  const ref = useNavProps<HTMLInputElement>({ onOKActionDescription: "Type" });
  return (
    <label style={{ display: "block", flex: "1 1 auto", minWidth: 0 }}>
      {label ? <span style={{ fontSize: "11px", color: "#8f98a0" }}>{label}</span> : null}
      <input
        ref={ref}
        data-nav="target"
        type="text"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => onChange?.({ target: { value: event.target.value } })}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "7px 10px",
          borderRadius: "6px",
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: "13px",
        }}
      />
    </label>
  );
};

interface ButtonProps {
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  [key: string]: any;
}

export const Button = ({ onClick, className, children, disabled, ...rest }: ButtonProps) => {
  const { nav } = split(rest);
  const ref = useNavProps<HTMLButtonElement>(nav);
  return (
    <button
      ref={ref}
      type="button"
      data-nav="target"
      className={className}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "30px",
        minWidth: "32px",
        padding: "0 8px",
        borderRadius: "4px",
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(255,255,255,0.06)",
        color: "#d6d7d8",
        cursor: "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
};

export const FocusRing = ({ className, children }: { className?: string; children?: ReactNode }) => (
  <div className={className} style={{ display: "block", width: "100%" }}>
    {children}
  </div>
);

export const staticClasses = { Title: "DeckyTitle" } as Record<string, string>;
