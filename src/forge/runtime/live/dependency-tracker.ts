import type { AuthContext } from "../auth/types.ts";
import type { DataChange, DataDependency, WriteTracker } from "./types.ts";

export class DependencyTracker {
  private readonly dependenciesByKey = new Map<string, DataDependency>();

  record(table: string, tenantId: string | null): void {
    if (!tenantId) {
      return;
    }
    const key = `${table}:${tenantId}`;
    this.dependenciesByKey.set(key, { table, tenantId });
  }

  snapshot(): DataDependency[] {
    return [...this.dependenciesByKey.values()].sort((a, b) => {
      if (a.table !== b.table) {
        return a.table < b.table ? -1 : 1;
      }
      return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
    });
  }
}

export function tenantIdFromAuth(auth: AuthContext | undefined): string | null {
  if (auth?.kind === "user") {
    return auth.tenantId;
  }
  if (auth?.kind === "system" && auth.tenantId) {
    return auth.tenantId;
  }
  return null;
}

export function createWriteTracker(): WriteTracker {
  const byKey = new Map<string, DataChange>();

  return {
    get changes() {
      return [...byKey.values()].sort((a, b) => {
        const tableA = a.tables.join(",");
        const tableB = b.tables.join(",");
        if (tableA !== tableB) {
          return tableA < tableB ? -1 : 1;
        }
        return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
      });
    },
    record(table, tenantId) {
      if (!tenantId) {
        return;
      }
      const key = `${table}:${tenantId}`;
      byKey.set(key, { tables: [table], tenantId });
    },
  };
}
