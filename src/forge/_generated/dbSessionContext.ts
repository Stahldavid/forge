// @forge-generated generator=0.1.0-alpha.14 input=a43a0684c37e2ef6e7bce4adf441dbc821a8de9a5fa05aca373a8dd420940b7d content=e54bf648fe6662c29d0d9c42922a496c64c84a75baf369274e75ff48da670d2a
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
