import type { NextConfig } from "next";

const forgeApiUrl = process.env.NEXT_PUBLIC_FORGE_URL ?? "http://127.0.0.1:3765";
const forgeProxyPaths = [
  ".well-known/:path*",
  "ai/:path*",
  "auth.md",
  "callback",
  "commands/:path*",
  "entries/:path*",
  "external/:path*",
  "health",
  "live/:path*",
  "login",
  "logout",
  "session",
  "queries/:path*",
  "webhooks/:path*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["forge"],
  async rewrites() {
    return forgeProxyPaths.map((source) => ({
      source: `/${source}`,
      destination: `${forgeApiUrl}/${source}`,
    }));
  },
};

export default nextConfig;
