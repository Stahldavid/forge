// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=76688ffe1f53e332adc5ed1064822afe1a61ed711f647608c744b08657a434b9
# Capability Map

Project: basic-forge-app

## Summary

- Covered: 0
- Backend-only: 6
- Frontend-only: 0
- Warnings: 0

## Capabilities

### runtime:command:badStripeCommand
Status: backend-only
User action: Call command badStripeCommand
Runtime: command badStripeCommand
Hook: useCommand(api.commands.badStripeCommand)
HTTP: POST /commands/badStripeCommand
Policy: public
Reads: none
Writes: none
Emits: none
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.

### runtime:command:createTicket
Status: backend-only
User action: Call command createTicket
Runtime: command createTicket
Hook: useCommand(api.commands.createTicket)
HTTP: POST /commands/createTicket
Policy: tickets.create
Reads: none
Writes: tickets
Emits: ticket.created
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.

### runtime:command:manageBilling
Status: backend-only
User action: Call command manageBilling
Runtime: command manageBilling
Hook: useCommand(api.commands.manageBilling)
HTTP: POST /commands/manageBilling
Policy: billing.manage
Reads: none
Writes: none
Emits: none
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.

### runtime:liveQuery:liveTickets
Status: backend-only
User action: Subscribe to liveQuery liveTickets
Runtime: liveQuery liveTickets
Hook: useLiveQuery(api.liveQueries.liveTickets, args)
HTTP: GET /live/liveTickets
Policy: tickets.read
Reads: tickets
Writes: none
Emits: none
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.

### runtime:query:getTicket
Status: backend-only
User action: Read query getTicket
Runtime: query getTicket
Hook: useQuery(api.queries.getTicket, args)
HTTP: POST /queries/getTicket
Policy: tickets.read
Reads: tickets
Writes: none
Emits: none
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.

### runtime:query:listTickets
Status: backend-only
User action: Read query listTickets
Runtime: query listTickets
Hook: useQuery(api.queries.listTickets, args)
HTTP: POST /queries/listTickets
Policy: tickets.read
Reads: tickets
Writes: none
Emits: none
Notes:
- Runtime entry is available to agents even though no frontend usage was detected.
