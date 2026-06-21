import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ForgeProvider, forgeUrl } from "./lib/forge";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ForgeProvider baseUrl={forgeUrl} devAuth={{ tenantId: "demo", userId: "demo-user", role: "owner" }}>
      <App />
    </ForgeProvider>
  </React.StrictMode>,
);
