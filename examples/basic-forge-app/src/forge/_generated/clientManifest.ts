// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=5cc6420638f90aa843417d86696e66364c1e784bb818ee189119c47f786cadfb
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "eaf0c9fdcc2e3e5fa73fe28c984c325ec0de2c973368deb12648c7ce2efeb67f",
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
