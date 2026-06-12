// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=ae738996f9fb58de04ed31787192cc5084c3feacfefcbd620feb22b0e0f515f8
# App Map

## Data

### tenants
Tenant-scoped: no
Fields:
- id

### tickets
Tenant-scoped: yes
Tenant field: tenant_id
Fields:
- createdAt
- id
- status
- tenantId
- title

## Commands

### badStripeCommand
Policy: public
HTTP: POST /commands/badStripeCommand
Frontend hook: `useCommand(api.commands.badStripeCommand)`
Frontend routes:
- none
Frontend components:
- none
Writes:
- none
Reads:
- none
Emits:
- none

### createTicket
Policy: tickets.create
HTTP: POST /commands/createTicket
Frontend hook: `useCommand(api.commands.createTicket)`
Frontend routes:
- none
Frontend components:
- none
Writes:
- tickets
Reads:
- none
Emits:
- ticket.created

### manageBilling
Policy: billing.manage
HTTP: POST /commands/manageBilling
Frontend hook: `useCommand(api.commands.manageBilling)`
Frontend routes:
- none
Frontend components:
- none
Writes:
- none
Reads:
- none
Emits:
- none

## Queries

### getTicket
Policy: tickets.read
HTTP: POST /queries/getTicket
Frontend hook: `useQuery(api.queries.getTicket, args)`
Read-only: yes
Reads:
- tickets
Frontend routes:
- none
Frontend components:
- none

### listTickets
Policy: tickets.read
HTTP: POST /queries/listTickets
Frontend hook: `useQuery(api.queries.listTickets, args)`
Read-only: yes
Reads:
- tickets
Frontend routes:
- none
Frontend components:
- none

## Live Queries

### liveTickets
Policy: tickets.read
HTTP: GET /live/liveTickets
Frontend hook: `useLiveQuery(api.liveQueries.liveTickets, args)`
Reads:
- tickets
Frontend routes:
- none
Frontend components:
- none
Dependencies:
- tickets (tenant)

## Actions

### capturePosthog
File: src/actions/capturePosthog.ts

### captureTicketCreated
File: src/actions/captureTicketCreated.ts

### createCheckout
File: src/actions/createCheckout.ts

## Workflows

### triageTicketWorkflow
Trigger: ticket.created
Steps:
- loadTicket
- triageWithAI
- captureTriageAnalytics

## Frontend

Present: no
Framework: none

### Routes

### Components

### Client Bindings

- none

### Runtime Endpoints

- command badStripeCommand: POST /commands/badStripeCommand; useCommand(api.commands.badStripeCommand)
- command createTicket: POST /commands/createTicket; useCommand(api.commands.createTicket)
- command manageBilling: POST /commands/manageBilling; useCommand(api.commands.manageBilling)
- liveQuery liveTickets: GET /live/liveTickets; useLiveQuery(api.liveQueries.liveTickets, args)
- query getTicket: POST /queries/getTicket; useQuery(api.queries.getTicket, args)
- query listTickets: POST /queries/listTickets; useQuery(api.queries.listTickets, args)

### Full-Stack Route Bindings

- none
