import { createRoot } from "react-dom/client";
import CoverImage from "../../src/components/CoverImage";
import { injectStyles } from "../../src/styles";

injectStyles();
const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <div style={{ width: "220px", height: "165px", position: "relative", background: "#05070a" }}>
      <div className="rs-cover" style={{ width: "220px" }}>
        <CoverImage
          url="https://static.romspedia.com/webp/roms/super-mario-64-cover.webp"
          alt="test"
          eager
        />
      </div>
    </div>,
  );
}
