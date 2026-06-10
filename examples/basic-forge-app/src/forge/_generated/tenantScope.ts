// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=8d68610441dbf28cbd43229ebec883556cb15909c08c688a56fe8eaf55329008
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
  "inputHash": "5c8ab223231f44f0540bf05c447e2fd745fc7d71359a672095570c36fa8a0633",
  "schemaVersion": "1.0.0",
  "tables": [
    {
      "exportName": "tickets",
      "file": "src/forge/schema.ts",
      "table": "tickets",
      "tenantIdColumn": "tenant_id"
    }
  ]
} as const;
