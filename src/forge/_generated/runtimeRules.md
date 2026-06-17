// @forge-generated generator=0.1.0-alpha.9 input=11d52fee585f53d8e2be9d455295ba3ac5ff6b218e315ec8a27fc58cfdefcb5f content=e05aaac5db95a6a159a7c3f79e5fd6a862fe5728756f1bc11a9cac0b834f3023
# Runtime Rules

## LiveQuery Production

Allowed:
- durable invalidation rows in _forge_live_invalidations
- polling fallback
- Postgres notify wakeups
- SSE heartbeats and Last-Event-ID resume

Forbidden:
- treating Pub/Sub or in-memory notification as the source of truth
- unbounded snapshot queues
- cross-tenant invalidation fanout

## command

Allowed:
- ctx.db writes
- ctx.emit
- ctx.telemetry buffered events

Forbidden:
- network packages
- ctx.secrets
- ctx.ai
- ctx.ai.runAgent
- ctx.agent.run
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
- ctx.ai.runAgent
- ctx.agent.run
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
- ctx.ai.runAgent
- ctx.agent.run
- network integrations

## action

Allowed:
- ctx.secrets
- integrations
- ctx.ai
- ctx.ai.runAgent
- ctx.agent.run
- AI SDK tools
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
- ctx.ai.runAgent
- ctx.agent.run
- AI SDK ToolLoopAgent
- retries

Forbidden:
- non-idempotent step behavior without guards
