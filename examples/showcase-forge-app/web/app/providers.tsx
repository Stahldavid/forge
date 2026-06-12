"use client";

import type { ReactNode } from "react";
import { ForgeProvider, forgeUrl } from "../lib/forge";

export const demoTenantId = "11111111-1111-4111-8111-111111111111";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ForgeProvider
      url={forgeUrl}
      devAuth={{
        userId: "u1",
        tenantId: demoTenantId,
        role: "member",
      }}
    >
      {children}
    </ForgeProvider>
  );
}
