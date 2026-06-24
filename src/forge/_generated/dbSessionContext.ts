// @forge-generated generator=0.1.0-alpha.23 input=eec97c876c38e3c86c16e6a488b4abbd0d9253406b5e3a492f6674a134d0d950 content=e54bf648fe6662c29d0d9c42922a496c64c84a75baf369274e75ff48da670d2a
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
