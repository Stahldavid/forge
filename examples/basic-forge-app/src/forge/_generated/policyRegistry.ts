// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=7731a2ecbbbfbb475235120c8ce0a8280e47d5bb1633667eb7cab4e38da708a0
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
  "inputHash": "f98e1f6bab802731a2ec7dbb0d10eba4556bc3f38aa853ccca9d3b8835280170",
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
    },
    {
      "auth": {
        "kind": "policy",
        "policy": "tickets.read"
      },
      "file": "src/queries/liveTickets.ts",
      "queryName": "liveTickets",
      "symbolId": "f0ec05ae27f05d878b9857863da6013269c57f29f07d4b2f3b59ea84d5878ff5"
    }
  ],
  "schemaVersion": "1.0.0"
} as const;
