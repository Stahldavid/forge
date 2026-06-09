export interface ForgeTableConfig {
  name: string;
  fields?: Record<string, string>;
}

export interface ForgeTable {
  __forge: { kind: "schema.table" };
  name: string;
  fields: Record<string, string>;
}

export function defineTable(
  nameOrConfig: string | ForgeTableConfig,
  fields?: Record<string, string>,
): ForgeTable {
  if (typeof nameOrConfig === "string") {
    return {
      __forge: { kind: "schema.table" },
      name: nameOrConfig,
      fields: fields ?? {},
    };
  }

  return {
    __forge: { kind: "schema.table" },
    name: nameOrConfig.name,
    fields: nameOrConfig.fields ?? {},
  };
}
