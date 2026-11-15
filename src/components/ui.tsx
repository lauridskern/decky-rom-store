import { FC, ReactNode } from "react";

/**
 * Small visual pieces shared by the views. None of them takes focus: the
 * element around them does (a Focusable or a Button, see gamepad.ts).
 */

/** A controller button drawn next to the thing it acts on (L1, R2, X). */
export const Glyph: FC<{ children: ReactNode; round?: boolean }> = ({ children, round }) => (
  <span className={`rs-glyph${round ? " round" : ""}`} aria-hidden="true">
    {children}
  </span>
);

/** The knob of a switch; the row around it is what the d-pad focuses. */
export const Switch: FC<{ on: boolean }> = ({ on }) => (
  <span className={`rs-switch${on ? " on" : ""}`} aria-hidden="true">
    <span />
  </span>
);

export const Spinner: FC = () => <div className="rs-spinner" />;

/** A screen with nothing on it yet: what it is for and what to do next. */
export const EmptyState: FC<{ icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }> = ({
  icon,
  title,
  children,
  action,
}) => (
  <div className="rs-empty">
    <div className="rs-empty-icon">{icon}</div>
    <h2>{title}</h2>
    {children ? <p>{children}</p> : null}
    {action}
  </div>
);

/** A thin progress bar, 0 to 1. */
export const Progress: FC<{ value: number; tone?: "good" }> = ({ value, tone }) => (
  <div className={`rs-progress${tone ? ` ${tone}` : ""}`}>
    <div style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10}%` }} />
  </div>
);
