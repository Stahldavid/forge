"use client";

import { api, useCommand } from "../lib/forge";
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
