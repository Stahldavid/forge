// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=335b842758495332ff20dca5deedc3f63b3fb1e890afbae4d2123ac84450387f
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
Writes:
- none
Emits:
- none

### createTicket
Policy: tickets.create
Writes:
- none
Emits:
- none

### manageBilling
Policy: billing.manage
Writes:
- none
Emits:
- none

## Queries

### getTicket
Policy: tickets.read
Read-only: yes

### listTickets
Policy: tickets.read
Read-only: yes

## Live Queries

### liveTickets
Policy: tickets.read
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
