import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const forgeApiUrl = process.env.VITE_FORGE_URL ?? "http://127.0.0.1:3765";

const forgeProxyPaths = [
  "/.well-known",
  "/ai",
  "/auth.md",
  "/callback",
  "/commands",
  "/entries",
  "/external",
  "/health",
  "/live",
  "/login",
  "/logout",
  "/session",
  "/queries",
  "/webhooks",
];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      forgeProxyPaths.map((path) => [
        path,
        {
          target: forgeApiUrl,
          changeOrigin: true,
        },
      ]),
    ),
  },
});
