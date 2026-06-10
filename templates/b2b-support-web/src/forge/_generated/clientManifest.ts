// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=ac2becc55d9aa0901b5815b8c1694e62d3d13c0c0fbb044591f3061a44496496
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "746f5a7c66db061bb8aac113d2a81161d7d041b6356c7aa75de7ca46124b284d",
  "queries": [
    "getTicket",
    "listTickets"
  ],
  "commands": [
    "closeTicket",
    "createTicket",
    "manageBilling"
  ],
  "liveQueries": [
    "liveTickets"
  ],
  "transport": {
    "queries": "POST /queries/:name",
    "commands": "POST /commands/:name",
    "liveQueries": "GET /live/:name"
  },
  "react": {
    "entrypoint": "src/forge/_generated/react.ts",
    "hooks": [
      "ForgeProvider",
      "useForgeClient",
      "useAuth",
      "useQuery",
      "useCommand",
      "useLiveQuery"
    ]
  },
  "excluded": {
    "actions": [
      "captureTicketCreated"
    ],
    "workflows": [
      "triageTicketWorkflow"
    ],
    "serverAdapters": [],
    "serverPackages": []
  }
} as const;
