import type { TelemetryContext } from "../telemetry/types.ts";
import type { AuthContext } from "../auth/types.ts";
import type { ReadOnlyDbClient } from "../db/read-only-client.ts";
import { assertQueryContextForbidden } from "../db/read-only-client.ts";

export interface QueryContext {
  db: ReadOnlyDbClient;
  telemetry: TelemetryContext;
  auth: AuthContext;
  emit: never;
  secrets: never;
  ai: never;
}

export function createQueryContext(
  db: ReadOnlyDbClient,
  telemetry: TelemetryContext,
  auth: AuthContext,
): QueryContext {
  return {
    db,
    telemetry,
    auth,
    get emit(): never {
      return assertQueryContextForbidden("emit");
    },
    get secrets(): never {
      return assertQueryContextForbidden("secrets");
    },
    get ai(): never {
      return assertQueryContextForbidden("ai");
    },
  };
}
