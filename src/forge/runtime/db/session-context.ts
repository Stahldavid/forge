import type { AuthContext } from "../auth/types.ts";
import type { DbTransaction } from "./adapter.ts";

export interface DbSessionContextSetting {
  name: string;
  value: string;
}

function jsonArray(values: string[] | undefined): string {
  return JSON.stringify(values ?? []);
}

export function dbSessionContextFromAuth(auth: AuthContext): DbSessionContextSetting[] {
  if (auth.kind === "user") {
    return [
      { name: "forge.tenant_id", value: auth.tenantId ?? "" },
      { name: "forge.user_id", value: auth.userId },
      { name: "forge.role", value: auth.role ?? auth.roles?.[0] ?? "" },
      { name: "forge.roles", value: jsonArray(auth.roles) },
      { name: "forge.permissions", value: jsonArray(auth.permissions) },
    ];
  }

  if (auth.kind === "system") {
    return [
      { name: "forge.tenant_id", value: auth.tenantId ?? "" },
      { name: "forge.user_id", value: "system" },
      { name: "forge.role", value: "system" },
      { name: "forge.roles", value: JSON.stringify(["system"]) },
      { name: "forge.permissions", value: JSON.stringify([]) },
    ];
  }

  return [
    { name: "forge.tenant_id", value: "" },
    { name: "forge.user_id", value: "" },
    { name: "forge.role", value: "" },
    { name: "forge.roles", value: JSON.stringify([]) },
    { name: "forge.permissions", value: JSON.stringify([]) },
  ];
}

export async function setDbSessionContext(
  tx: DbTransaction,
  auth: AuthContext,
): Promise<void> {
  for (const setting of dbSessionContextFromAuth(auth)) {
    await tx.query("SELECT set_config($1, $2, true)", [setting.name, setting.value]);
  }
}

export function databaseUrlUsesPostgresSuperuser(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) {
    return false;
  }
  try {
    const parsed = new URL(databaseUrl);
    return parsed.username === "postgres";
  } catch {
    return false;
  }
}
