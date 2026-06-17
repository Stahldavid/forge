// @forge-generated generator=0.1.0-alpha.9 input=7e1d521593b626abf25a35531d4a4d31d541cae45c515610751b15e073c4d5a7 content=e54bf648fe6662c29d0d9c42922a496c64c84a75baf369274e75ff48da670d2a
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
