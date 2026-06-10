"use client";

import type { ReactNode } from "react";
import { ForgeProvider } from "../../src/forge/_generated/react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ForgeProvider
      url={process.env.NEXT_PUBLIC_FORGE_URL ?? "http://127.0.0.1:3765"}
      auth={{
        userId: "u1",
        tenantId: "t1",
        role: "member",
      }}
    >
      {children}
    </ForgeProvider>
  );
}
