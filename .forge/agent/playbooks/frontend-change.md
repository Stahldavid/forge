# Playbook: Frontend Change

1. Use generated client APIs and framework bindings: React hooks or Vue composables.
2. Do not import server adapters or server-only packages into client code.
3. Preserve `ForgeError.traceId` in visible error states.
4. Run affected frontend tests and `forge verify --changed`.
