import { createRoot } from "react-dom/client";
import StoreHost from "../../src/components/StoreHost";
import { injectStyles } from "../../src/styles";

injectStyles();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<StoreHost />);
}
