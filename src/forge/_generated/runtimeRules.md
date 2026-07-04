// @forge-generated generator=0.1.0-alpha.61 input=3e83e39b92f8a1e2337d18ed7565f99b151980139cd5104f0b7f462eedfed3b9 content=f34621bb356296c9c4f8bdfd69cc97add875bb0a8c15c60f7cbae9b59906e069
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
- direct secret/env access
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
