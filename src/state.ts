/** Tiny shared state so the side menu can hand a search term to the store. */
export const searchState = {
  query: "",
  system: "all",
  version: 0,
};

export function requestSearch(query: string, system = "all"): void {
  searchState.query = query;
  searchState.system = system;
  searchState.version += 1;
}

/**
 * A counter the store view is keyed on. Bumping it throws the whole React tree
 * away and builds it again - the escape hatch for a UI that has been open for
 * hours and slowed down, and a diagnostic: if this fixes it, the slowdown is
 * in the view, not in the data.
 */
let viewEpoch = 0;
const reloadListeners = new Set<() => void>();

export function reloadStore(): void {
  viewEpoch += 1;
  reloadListeners.forEach((listener) => listener());
}

export function subscribeStoreReload(listener: () => void): () => void {
  reloadListeners.add(listener);
  return () => {
    reloadListeners.delete(listener);
  };
}

export function getStoreEpoch(): number {
  return viewEpoch;
}
