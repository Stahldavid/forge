// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=66a1bb4c0ff347ce3105d777bcd057337f59dffd529d28cf2d1db133cac29411
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "0102fd7166668c952d21d040ef610832db354a239b9157a33718dc00e15139c7",
  "queries": [
    "getTicket",
    "listTickets"
  ],
  "commands": [
    "badStripeCommand",
    "createTicket",
    "manageBilling"
  ],
  "liveQueries": [],
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
