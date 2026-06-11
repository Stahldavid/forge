// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=d6189c0910f1a4be373866fc275aeaacf6fa7e022c8fa613cff8381979ca4377
export const uiRoutes = {
  "routes": [
    {
      "name": "home",
      "path": "/",
      "uses": {
        "commands": [],
        "components": [],
        "liveQueries": [],
        "queries": []
      }
    },
    {
      "name": "tickets",
      "path": "/tickets",
      "uses": {
        "commands": [
          "createTicket",
          "manageBilling"
        ],
        "components": [
          "TicketList",
          "CreateTicketForm"
        ],
        "liveQueries": [
          "liveTickets"
        ],
        "queries": [
          "getTicket",
          "listTickets"
        ]
      }
    }
  ],
  "schemaVersion": "0.1.0"
} as const;
