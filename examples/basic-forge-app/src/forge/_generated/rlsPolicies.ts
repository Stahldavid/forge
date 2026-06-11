// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=bb62af322cc3cbbe21ad790700d49f7b786596ba0816a13521b0302ff3c9fd2d
export const rlsPolicies = {
  "diagnostics": [],
  "schemaVersion": "0.1.0",
  "tables": [
    {
      "forceRowLevelSecurity": true,
      "policies": [
        {
          "operation": "select",
          "policyName": "forge_tickets_select",
          "table": "tickets",
          "tenantColumn": "tenant_id",
          "tenantType": "uuid",
          "using": "\"tenant_id\" = forge.current_tenant_id()"
        },
        {
          "operation": "insert",
          "policyName": "forge_tickets_insert",
          "table": "tickets",
          "tenantColumn": "tenant_id",
          "tenantType": "uuid",
          "withCheck": "\"tenant_id\" = forge.current_tenant_id()"
        },
        {
          "operation": "update",
          "policyName": "forge_tickets_update",
          "table": "tickets",
          "tenantColumn": "tenant_id",
          "tenantType": "uuid",
          "using": "\"tenant_id\" = forge.current_tenant_id()",
          "withCheck": "\"tenant_id\" = forge.current_tenant_id()"
        },
        {
          "operation": "delete",
          "policyName": "forge_tickets_delete",
          "table": "tickets",
          "tenantColumn": "tenant_id",
          "tenantType": "uuid",
          "using": "\"tenant_id\" = forge.current_tenant_id()"
        }
      ],
      "rowLevelSecurityEnabled": true,
      "table": "tickets",
      "tenantColumn": "tenant_id",
      "tenantType": "uuid"
    }
  ]
} as const;
