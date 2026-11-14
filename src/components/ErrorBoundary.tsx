import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Without this a render error inside the plugin takes the whole route down and
 * the Deck shows an empty screen with no hint what happened.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`ROM Store${this.props.label ? ` (${this.props.label})` : ""} crashed:`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="rs-error-screen">
        <h2>ROM Store hit an error</h2>
        <p>The plugin could not render. The details below help to fix it.</p>
        <pre>{String(error?.message || error)}</pre>
        <button className="rs-btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
