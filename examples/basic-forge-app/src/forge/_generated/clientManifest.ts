// @forge-generated generator=0.0.0 input=dbed69e6d72dbc70c4da980e189c370546d6773f069f0b210a3b192dab421887 content=a38a5e55d6b059271f8adee920bf4ca310c500ec315ade801126c1cf7e7db0a0
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "757e72269d800f66851fd270d70d42458e8346958585bf0d29f2571291207f00",
  "queries": [
    "getTicket",
    "listTickets"
  ],
  "commands": [
    "badStripeCommand",
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
      "capturePosthog",
      "captureTicketCreated",
      "createCheckout"
    ],
    "workflows": [
      "triageTicketWorkflow"
    ],
    "serverAdapters": [
      "posthog.server.ts",
      "stripe.server.ts"
    ],
    "serverPackages": [
      "stripe"
    ]
  }
} as const;
