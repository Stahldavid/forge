// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=d0073d43e1dae54361e2b4dbcbd9eca8f8c0b4e1bfb006d111ae15617ef409fa
export const policyRegistry = {
  "analyzerVersion": "policy-registry@1.0.0",
  "commandAuth": [
    {
      "auth": {
        "kind": "policy",
        "policy": "tickets.close"
      },
      "commandName": "closeTicket",
      "file": "src/commands/closeTicket.ts",
      "symbolId": "2d71a15b417661c77cc98dcf3cf2405ab6384349cb130b9d4077c4a157b1b968"
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
  "inputHash": "b4d96c8fcd4e93ea42f760dd9a59ee7a4bedef0233a5205ba9668aa040f88d61",
  "policies": [
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "billing.manage",
      "roles": [
        "owner"
      ],
      "symbolId": "e8dbd644a8a56f31a4019feb122c891dfd4d81220563ca7c0d38233a5fd54833"
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.close",
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
    },
    {
      "file": "src/policies.ts",
      "kind": "roles",
      "name": "tickets.update",
      "roles": [
        "owner",
        "admin"
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
