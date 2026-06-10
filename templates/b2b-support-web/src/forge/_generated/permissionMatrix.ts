// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=cba0b5f1944efdc7d223ceae0e94e3c0907d0687f22687a718d1fe40956ebe61
export const permissionMatrix = {
  "entries": [
    {
      "policy": "billing.manage",
      "roles": [
        "owner"
      ]
    },
    {
      "policy": "tickets.close",
      "roles": [
        "admin",
        "owner"
      ]
    },
    {
      "policy": "tickets.create",
      "roles": [
        "admin",
        "member",
        "owner"
      ]
    },
    {
      "policy": "tickets.read",
      "roles": [
        "admin",
        "member",
        "owner"
      ]
    },
    {
      "policy": "tickets.update",
      "roles": [
        "admin",
        "owner"
      ]
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "b4d96c8fcd4e93ea42f760dd9a59ee7a4bedef0233a5205ba9668aa040f88d61",
  "schemaVersion": "1.0.0"
} as const;
