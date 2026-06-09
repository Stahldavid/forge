import { join } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_CONNECT_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbAdapter, DbAdapterKind } from "./adapter.ts";
import { createMemoryAdapter } from "./memory-adapter.ts";
import { createPgliteAdapter } from "./pglite-adapter.ts";
import { createPostgresAdapter } from "./postgres-adapter.ts";

export interface CreateDbAdapterOptions {
  kind: DbAdapterKind;
  workspaceRoot?: string;
  databaseUrl?: string;
  dataDir?: string;
}

export interface CreateDbAdapterResult {
  adapter: DbAdapter | null;
  diagnostics: Diagnostic[];
}

const DEFAULT_PGLITE_DIR = ".forge/pglite";

export async function createDbAdapter(
  options: CreateDbAdapterOptions,
): Promise<CreateDbAdapterResult> {
  const diagnostics: Diagnostic[] = [];

  try {
    if (options.kind === "memory") {
      return { adapter: createMemoryAdapter(), diagnostics };
    }

    if (options.kind === "pglite") {
      const workspaceRoot = options.workspaceRoot ?? process.cwd();
      const dataDir = options.dataDir ?? join(workspaceRoot, DEFAULT_PGLITE_DIR);
      const adapter = await createPgliteAdapter(dataDir);
      return { adapter, diagnostics };
    }

    if (options.kind === "postgres") {
      const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
      if (!databaseUrl) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: FORGE_DB_CONNECT_FAILED,
            message: "postgres adapter requires --database-url or DATABASE_URL",
          }),
        );
        return { adapter: null, diagnostics };
      }

      const result = createPostgresAdapter(databaseUrl);
      if (!result.adapter) {
        diagnostics.push(result.diagnostic);
        return { adapter: null, diagnostics };
      }

      await result.adapter.query("SELECT 1");
      return { adapter: result.adapter, diagnostics };
    }

    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_CONNECT_FAILED,
        message: `unsupported db adapter kind '${options.kind as string}'`,
      }),
    );
    return { adapter: null, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "database connection failed";
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_CONNECT_FAILED,
        message,
      }),
    );
    return { adapter: null, diagnostics };
  }
}
