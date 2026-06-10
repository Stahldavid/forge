// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=7ed9464e45a7a7a851216ad3ed138cf3472c8ab5267e2d9b7543b855e5e48bee
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "5e7901a9929baf08d2d67fec8dc591aae9debaba8bd62d54829e1a5ffe525915",
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
