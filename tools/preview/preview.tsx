import { createRoot } from "react-dom/client";
import Store from "../../src/components/Store";
import { injectStyles } from "../../src/styles";

injectStyles();

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Store />);
}
