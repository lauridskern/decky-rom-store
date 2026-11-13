/**
 * Minimal stand-in for @decky/ui so the store can be rendered outside of the
 * Steam client (the real package reaches into Decky's webpack globals).
 */
import { FC, HTMLAttributes, ReactNode } from "react";

interface FocusableProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  focusClassName?: string;
  focusWithinClassName?: string;
  noFocusRing?: boolean;
  onActivate?: (e: CustomEvent) => void;
  onCancel?: (e: CustomEvent) => void;
}

export const Focusable: FC<FocusableProps> = ({ children, focusClassName, focusWithinClassName, onActivate, ...rest }) => (
  <div
    {...rest}
    tabIndex={rest.tabIndex ?? 0}
    data-focus-class={focusClassName}
    onKeyDown={(event) => {
      if (event.key === "Enter") onActivate?.(new CustomEvent("activate"));
      rest.onKeyDown?.(event);
    }}
  >
    {children}
  </div>
);

export const staticClasses = { Title: "DeckyTitle" } as Record<string, string>;
