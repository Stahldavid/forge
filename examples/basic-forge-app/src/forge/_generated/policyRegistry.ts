// @forge-generated generator=0.0.0 input=2109cd49dea7ae4cd20f98fc0ce6dce0a08c3e3732a7d77f530851d6d134f995 content=2f86d17366062524be5058393142f27697e84cb31c7149d3c57da4a32d545e26
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
  "inputHash": "a9eefc477ae8ace40243eef4a6381f9343000a883be1c4fa4a5c1f5bfc9ad779",
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
  "queryAuth": [
    {
      "auth": {
        "kind": "policy",
        "policy": "tickets.read"
      },
      "file": "src/queries/getTicket.ts",
      "queryName": "getTicket",
      "symbolId": "1e727ed1e784d7d51df4f835bf7089d854c5ca6b9b41951f60fa02524eb1add8"
    },
    {
      "auth": {
        "kind": "policy",
        "policy": "tickets.read"
      },
      "file": "src/queries/listTickets.ts",
      "queryName": "listTickets",
      "symbolId": "b0a3ac02fbd7892a43ea9251936f3b3922249effde56636319d550480d443c28"
    }
  ],
  "schemaVersion": "1.0.0"
} as const;
