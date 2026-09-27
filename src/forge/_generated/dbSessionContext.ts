// @forge-generated generator=0.1.0-alpha.65 input=dbf2c962fa9cf8e2fa9dc988c6cf3a4e462e8f7dd759f143418b9538a08f4a85 content=e54bf648fe6662c29d0d9c42922a496c64c84a75baf369274e75ff48da670d2a
export const dbSessionContext = {
  "diagnostics": [],
  "method": "set_config",
  "schemaVersion": "0.1.0",
  "settings": [
    {
      "name": "forge.tenant_id",
      "required": true,
      "source": "ctx.auth",
      "transactionScoped": true
    },
    {
      "name": "forge.user_id",
      "required": false,
      "source": "ctx.auth",
      "transactionScoped": true
    },
    {
      "name": "forge.role",
      "required": false,
      "source": "ctx.auth",
      "transactionScoped": true
    },
    {
      "name": "forge.roles",
      "required": false,
      "source": "ctx.auth",
      "transactionScoped": true
    },
    {
      "name": "forge.permissions",
      "required": false,
      "source": "ctx.auth",
      "transactionScoped": true
    }
  ],
  "transactionScoped": true
} as const;
