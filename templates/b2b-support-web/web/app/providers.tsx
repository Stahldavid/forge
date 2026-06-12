"use client";

import type { ReactNode } from "react";
import { ForgeProvider, forgeUrl } from "../lib/forge";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ForgeProvider
      url={forgeUrl}
      devAuth={{
        userId: "u1",
        tenantId: "t1",
        role: "member",
      }}
    >
      {children}
    </ForgeProvider>
  );
}
