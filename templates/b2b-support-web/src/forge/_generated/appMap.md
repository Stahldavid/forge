// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=6eeaa256adef4315f7d0c11d90e440a6832ef99d681797f40ccdd1913f6112bf
# App Map

## Data

### tenants
Tenant-scoped: no
Fields:
- createdAt
- id

### tickets
Tenant-scoped: yes
Tenant field: tenant_id
Fields:
- createdAt
- id
- severity
- status
- tenantId
- title
- triageSummary
- updatedAt

### users
Tenant-scoped: yes
Tenant field: tenant_id
Fields:
- createdAt
- email
- id
- role
- tenantId

## Commands

### closeTicket
Policy: tickets.close
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
- users (tenant)

## Actions

### captureTicketCreated
File: src/actions/captureTicketCreated.ts

## Workflows

### triageTicketWorkflow
Trigger: ticket.created
Steps:
- loadTicket
- triageWithAI
- saveTriage
- captureTriageTelemetry
