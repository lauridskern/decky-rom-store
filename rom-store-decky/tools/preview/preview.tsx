import { createRoot } from "react-dom/client";
import Store from "../../src/components/Store";
import { injectStyles } from "../../src/styles";

injectStyles();

// Headless Chrome rasterises images inside a composited scroll layer at a
// reduced scale (blurry upscale). The preview renders without scrolling.
const style = document.createElement("style");
style.textContent = ".rs-main { overflow: visible !important; height: auto !important; }";
document.head.appendChild(style);

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Store />);
}
