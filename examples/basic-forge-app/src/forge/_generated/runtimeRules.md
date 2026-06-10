// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=60219a0216fb803bae9be477960e36b13491239896d23c89398d6f8ff895cfb5
# Runtime Rules

## command

Allowed:
- ctx.db writes
- ctx.emit
- ctx.telemetry buffered events

Forbidden:
- network packages
- ctx.secrets
- ctx.ai
- process.env
- filesystem access

## query

Allowed:
- ctx.db reads
- ctx.telemetry buffered events

Forbidden:
- insert/update/delete
- ctx.emit
- ctx.secrets
- ctx.ai
- network integrations

## liveQuery

Allowed:
- ctx.db reads
- tenant-scoped subscriptions

Forbidden:
- insert/update/delete
- ctx.emit
- ctx.secrets
- ctx.ai
- network integrations

## action

Allowed:
- ctx.secrets
- integrations
- ctx.ai
- ctx.db reads/writes
- network packages

Forbidden:
- uncommitted transactional side effects

## workflow

Allowed:
- durable steps
- ctx.secrets
- integrations
- ctx.ai
- retries

Forbidden:
- non-idempotent step behavior without guards
