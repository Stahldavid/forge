// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=16f424bab04b27f0661557126e1d7da99fafd39ca46e51bb05ef05f10c224a06
export const policyRegistry = {
  "analyzerVersion": "policy-registry@1.0.0",
  "commandAuth": [
    {
      "auth": {
        "kind": "user"
      },
      "commandName": "badStripeCommand",
      "file": "src/commands/badStripeCommand.ts",
      "symbolId": "e8ec0e9d28065ac2f252fcf405d9f3ce5f45c076aec51d76a2517e3dd9f1187e"
    },
    {
      "auth": {
        "kind": "policy",
        "policy": "tickets.create"
      },
      "commandName": "createTicket",
      "file": "src/commands/createTicket.ts",
      "symbolId": "9ce1769e06fe6bb452c729de0eb31289857eb6d48d3336bcc53af8ec79ddb226"
    },
    {
      "auth": {
        "kind": "policy",
        "policy": "billing.manage"
      },
      "commandName": "manageBilling",
      "file": "src/commands/manageBilling.ts",
      "symbolId": "5a384aee569b45ccaedc3c1645bcf675565a329390b4a45536f974026554e6ec"
    }
  ],
  "diagnostics": [],
  "generatorVersion": "0.0.0",
  "inputHash": "b2b048cc45d7656e965e5fb791a4451c12e8e1e738f6418534d26dac0ef44ce8",
  "policies": [
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "billing.manage",
      "roles": [
        "owner",
        "admin"
      ],
      "symbolId": "e8dbd644a8a56f31a4019feb122c891dfd4d81220563ca7c0d38233a5fd54833"
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.create",
      "roles": [
        "owner",
        "admin",
        "member"
      ],
      "symbolId": "e8dbd644a8a56f31a4019feb122c891dfd4d81220563ca7c0d38233a5fd54833"
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.read",
      "roles": [
        "owner",
        "admin",
        "member"
      ],
      "symbolId": "e8dbd644a8a56f31a4019feb122c891dfd4d81220563ca7c0d38233a5fd54833"
    }
  ],
  "schemaVersion": "1.0.0"
} as const;
