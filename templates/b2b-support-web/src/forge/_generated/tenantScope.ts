// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=61122dcb8a610b0098a503fdcf7b1bbb3d774992a9d0aecac734c4095c692584
export const tenantScope = {
  "diagnostics": [
    {
      "code": "FORGE_TENANT_TABLE_WITHOUT_TENANT_ID",
      "file": "src/forge/schema.ts",
      "message": "table 'tenants' looks tenant-related but has no tenantId field",
      "severity": "warning"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "bb2bae6f546a0e9bd8118e5655477ed105784e83bbe3044e3ef0c6db878f2d66",
  "schemaVersion": "1.0.0",
  "tables": [
    {
      "exportName": "tickets",
      "file": "src/forge/schema.ts",
      "table": "tickets",
      "tenantIdColumn": "tenant_id"
    },
    {
      "exportName": "users",
      "file": "src/forge/schema.ts",
      "table": "users",
      "tenantIdColumn": "tenant_id"
    }
  ]
} as const;
