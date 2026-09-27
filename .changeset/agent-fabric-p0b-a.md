---
"forgeos": minor
---

Add the experimental Agent Fabric P0b-A bounded model adapter behind the P0a authorization, permit, and result boundary. Model invocation binds the provider target, context, and materialization to one attempt; enforces finite request, response, token, and time limits; blocks hidden retries and redirects; and treats ambiguous execution as uncertainty. A fixed loopback Ollama path supports keyless local inference. Model output remains non-authoritative; tools, delegation, persistent recovery, and production readiness are outside this release.
