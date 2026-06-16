// @forge-generated generator=0.1.0-alpha.4 input=89430851907382c0b60cc8761af3b49eda8db4a6e8993691990c0e710d2bd8a7 content=e54bf648fe6662c29d0d9c42922a496c64c84a75baf369274e75ff48da670d2a
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
