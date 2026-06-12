import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ForgeProvider, forgeUrl } from "./lib/forge";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ForgeProvider url={forgeUrl} devAuth>
      <App />
    </ForgeProvider>
  </StrictMode>,
);
