# P0b-A model adapter implementation

This slice executes one content-bound, model-only text generation through the existing P0a
conductor and permit path. The adopted scope and acceptance gate remain in
`P0B_SCOPE_AND_GATE.md`.

`P0bModelAdapter.preflight()` checks the current permit, goal, authorization, grant,
dispatch intent, workflow node, exact `EffectiveRunSpec`, context pack, materialization,
provider/model target, harness, profile and finite bounds before dispatch. The wrapper
`executeP0bActivity()` runs preflight before the P0a activity boundary so a deterministic
rejection cannot be misreported as provider uncertainty. Direct `startAttempt()` also runs
preflight. Materialization accepts no endpoint, host or credential selector. The provider
resolver chooses the credential from the authorized provider. Context content is included in
the exact prompt supplied to the SDK.

The live executor uses AI SDK `generateText` with `maxRetries: 0`, an abort signal and a
transport guard that allows at most one physical request per invocation. Redirect handling is
manual so an HTTP 3xx cannot hide another request or a new host. The adapter keeps
one in-memory attempt record per attempt ID. A duplicate start with the same permit returns
the same startup identity; a different permit conflicts. Startup means the local executor
has begun, not that the provider accepted a request. There is no crash-safe exactly-once
claim.

Limits are 64 KiB for serialized non-secret request/materialization and result, 4096 output
tokens and 120 seconds wall-clock. An invocation may set smaller positive limits. The
profile's wall-clock limit must fit in the remaining permit window. Provider transport errors,
timeouts, cancellation without termination proof, late results and oversized results yield
uncertainty. Even if an oversized response appears complete, this slice does not assert
remote termination or completeness, so it does not commit a terminal failure. The complete
successful text is held in an ephemeral in-memory artifact keyed by attempt ID. Its digest
is bound into the report; the control journal contains the digest and no provider text.
`succeeded` proves structural invocation completion only. It does not decide the goal's
acceptance criteria or authorize instructions in the text.

## User-authorized keyless local extension

The original P0b plan named Forge's three hosted providers. The operator explicitly declined
API-key use and authorized a local Ollama extension on 2026-09-27. The trusted provider
resolver now maps `ollama` to the fixed `http://127.0.0.1:11434/v1` chat-completions endpoint.
The endpoint cannot be selected by a prompt or materialization. It uses the existing AI SDK
OpenAI-compatible client with a literal, nonsecret `ollama` placeholder, which the local
Ollama server ignores; no provider key is read. Redirects remain blocked. The authorized
target still binds the exact `ollama` provider and installed model ID. This extension is
limited to local model text generation and does not add general custom endpoints.

Deterministic coverage is in `tests/agent-fabric/p0b-model-adapter.test.ts`. For the
credential-free live smoke, install a local text model with `ollama pull qwen3:0.6b`,
ensure Ollama is serving loopback, and run from a clean checkout:

```bash
node --import tsx scripts/p0b-live-smoke.ts
```

The smoke reports the exact Git SHA, local environment, authorized provider/model target,
effect class, digest chain, permit/attempt, physical request count, result digest and replay
check. It prints no prompt, response text or credential. A passing local deterministic suite
is not a substitute for this live gate. The live run is required before P0b-A adoption/merge.
An explicit `FORGE_P0B_SMOKE_PROVIDER=openai` plus model and credential can still exercise the
hosted path, but the keyless Ollama path is the default and the one authorized here.
