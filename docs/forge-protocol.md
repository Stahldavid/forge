# Forge External Runtime Protocol

Forge apps can import and call services written outside TypeScript through a
`forge.manifest.json` compatible manifest. The manifest is the source of truth
for external commands and queries:

- validate and import external service metadata;
- expose external services in generated inspect/API/agent artifacts;
- execute external commands and queries through the Forge runtime bridge.

This lets Java/Spring, Go, Rust, C#, Python, and other runtimes join the Forge
contract without requiring the Forge compiler to parse every language AST.

## Manifest

External services publish JSON that matches
`schemas/forge-manifest.schema.json`.

```json
{
  "forgeProtocol": "1.0",
  "language": "java",
  "framework": "spring-boot",
  "service": {
    "name": "billing",
    "transport": "http",
    "baseUrl": "http://localhost:8080",
    "health": "/actuator/health"
  },
  "entries": [
    {
      "name": "createInvoice",
      "kind": "command",
      "path": "/invoices",
      "policy": "billing.write",
      "transaction": "external-managed",
      "risk": "write",
      "needsApproval": true,
      "effects": ["invoice.created"]
    },
    {
      "name": "listInvoices",
      "kind": "query",
      "path": "/invoices",
      "policy": "billing.read",
      "transaction": "read-only",
      "risk": "read",
      "tenantScoped": true
    }
  ]
}
```

Queries must stay read-only. Commands can declare write, destructive, or
external risk. Policies are metadata until the runtime bridge enforces them for
the external transport.

## CLI

Validate a manifest:

```bash
forge manifest validate ./forge.manifest.json --json
```

Import or update a service in the app registry:

```bash
forge manifest import ./forge.manifest.json --json
```

Imports are stored in `.forge/external-manifests.json`. A root
`forge.manifest.json` is also discovered automatically for single-service
experiments.

## Generated Artifacts

After `forge generate`, external services are emitted to:

- `src/forge/_generated/externalServices.json`
- `src/forge/_generated/api.json` under `external`
- `src/forge/_generated/agentContract.json`
- `src/forge/_generated/agentTools.json`
- `src/forge/_generated/capabilityMap.json`

External auto-tools use `execution: "external-runtime-endpoint"`. Forge exposes
runtime bridge endpoints for these tools:

```text
POST /external/:service/commands/:name
POST /external/:service/queries/:name
```

The generated client exposes the same bridge through:

```ts
await client.externalCommand("billing.createInvoice", args);
await client.externalQuery(api.external.queries["billing.listInvoices"], args);
```

Command entries can also be invoked from the CLI with a qualified external
name:

```bash
forge run billing.createInvoice --args '{"title":"Invoice"}'
forge query billing.listInvoices --args '{}'
```

## Runtime Bridge

Forge accepts the normal JSON body:

```json
{ "args": {} }
```

For HTTP services, Forge forwards a JSON envelope:

```json
{
  "args": {},
  "auth": { "kind": "user", "userId": "u1", "tenantId": "t1", "role": "member" },
  "forge": {
    "service": "billing",
    "entry": "createInvoice",
    "kind": "command",
    "traceId": "trace_..."
  }
}
```

Forge also forwards runtime headers such as `x-forge-trace-id`,
`x-forge-auth-kind`, `x-forge-user-id`, `x-forge-tenant-id`, `x-forge-role`,
and the inbound `Authorization` header when present.

External services can return either a Forge envelope:

```json
{ "ok": true, "result": { "id": "inv_1" } }
```

or a raw JSON value, which Forge treats as the result for successful HTTP
responses. Error envelopes should include `ok: false`, `diagnostics`, or
`error`.

Supported runtime transports:

- `http`: calls `service.baseUrl + entry.path`.
- `stdio`: starts `service.command`, writes the JSON envelope to stdin, and
  reads a JSON envelope or raw JSON result from stdout.
- `grpc`: accepted in manifests for forward compatibility, but not executable
  by the built-in runtime bridge yet.

Manifest `policy` values are added to Forge policy bindings during generation.
Use a named Forge policy, or `public`, `user`, or `system`.
