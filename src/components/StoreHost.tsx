import { useSyncExternalStore } from "react";
import { getStoreEpoch, subscribeStoreReload } from "../state";
import ErrorBoundary from "./ErrorBoundary";
import Store from "./Store";

/**
 * Mounts the store and rebuilds it from scratch whenever the view epoch is
 * bumped ("Reload the view" in the settings).
 */
const StoreHost = () => {
  const epoch = useSyncExternalStore(subscribeStoreReload, getStoreEpoch, getStoreEpoch);
  return (
    <ErrorBoundary label="store">
      <Store key={epoch} />
    </ErrorBoundary>
  );
};

export default StoreHost;
