import { FC } from "react";
import { CSS } from "../styles";

/**
 * The stylesheet is rendered inside the plugin's own React tree so it lives in
 * the same DOM as the UI - a <style> element applies to the whole document
 * wherever it sits.
 */
const StoreStyles: FC = () => <style id="rom-store-styles" dangerouslySetInnerHTML={{ __html: CSS }} />;

export default StoreStyles;
