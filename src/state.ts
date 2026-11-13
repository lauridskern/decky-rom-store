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
