"use client";

import type { ForgeReactError } from "../lib/forge";

export function TraceDetails({
  label,
  error,
}: {
  label: string;
  error: ForgeReactError;
}) {
  return (
    <p>
      {label}: {error.code}
      {error.traceId ? ` - trace ${error.traceId}` : null}
    </p>
  );
}
