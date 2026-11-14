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

interface DropdownProps {
  rgOptions?: { label: ReactNode; data: any }[];
  selectedOption?: any;
  onChange?: (option: { label: ReactNode; data: any }) => void;
  menuLabel?: string;
}

export const Dropdown: FC<DropdownProps> = ({ rgOptions = [], selectedOption, onChange }) => (
  <select
    value={selectedOption}
    onChange={(event) => {
      const found = rgOptions.find((option) => option.data === event.target.value);
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

export const staticClasses = { Title: "DeckyTitle" } as Record<string, string>;
