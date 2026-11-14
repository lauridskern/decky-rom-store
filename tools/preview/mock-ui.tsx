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

interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onKeyDown?: (event: any) => void;
  disabled?: boolean;
}

export const TextField: FC<TextFieldProps> = ({ label, value, placeholder, onChange, onKeyDown }) => (
  <label style={{ display: "block", flex: "1 1 auto", minWidth: 0 }}>
    <span style={{ fontSize: "11px", color: "#8f98a0" }}>{label}</span>
    <input
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

interface ButtonProps {
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

export const Button: FC<ButtonProps> = ({ onClick, className, children }) => (
  <button
    type="button"
    className={className}
    onClick={onClick}
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
    }}
  >
    {children}
  </button>
);

export const FocusRing: FC<{ className?: string; children?: ReactNode }> = ({ className, children }) => (
  <div className={className} style={{ display: "block", width: "100%" }}>
    {children}
  </div>
);

export const staticClasses = { Title: "DeckyTitle" } as Record<string, string>;
