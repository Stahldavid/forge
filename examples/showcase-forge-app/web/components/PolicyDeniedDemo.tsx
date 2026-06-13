"use client";

import { api } from "../../src/forge/_generated/api";
import { useCommand } from "../../src/forge/_generated/react";
import { TraceDetails } from "./TraceDetails";

export function PolicyDeniedDemo() {
  const manageBilling = useCommand(api.commands.manageBilling);

  return (
    <section className="panel stack">
      <div>
        <h2>Policy demo</h2>
        <p className="muted">The demo user has role member.</p>
      </div>

      <button
        data-forge-testid="billing-policy-denied-button"
        disabled={manageBilling.loading}
        onClick={() => {
          void manageBilling.run({});
        }}
      >
        Try billing.manage
      </button>

      {manageBilling.error ? (
        <TraceDetails label="Denied" error={manageBilling.error} />
      ) : null}
    </section>
  );
}
