# Repository runtime observation

## Goal and scope

Forge can analyze an existing Vue/Nuxt, Java/Spring or Docker repository without converting it into a Forge application. Static maps remain useful before installing dependencies or starting the application. The optional runtime layer supplements those maps with artifacts produced by explicit commands in an independent temporary source copy.

The runtime layer answers questions such as which components Nuxt registered after module preparation, which Spring beans and mappings a selected profile exposed, which containers and networks an exported Docker inspection described, and which HTTP paths a recorded execution requested. It does not claim comprehensive execution coverage, production correctness, authentication of external services, or that a generated Nuxt declaration proves a rendered component.

## Implementation plan

1. Extend protocol 2.0 repository manifests with optional `runtime.observations`. Each observation identifies a component, a sequence of executable argv arrays, contained working directories, per-command timeouts and a list of supported artifact formats. Reject unknown fields, duplicate identities, excessive inputs and unsafe paths. Commands are reviewed configuration, never inferred execution authority from static checks.
2. Implement pure, bounded collectors for Nuxt declarations, Spring Actuator mappings/beans, Docker inspection, HTTP traces and normalized Forge observations. Collect useful structural fields. Omit environment values, authorization, headers, request/response bodies, credentials, origins and query parameters. Malformed or oversized artifacts must not produce confident evidence.
3. Build a read-only plan API. Show exactly which commands and artifacts are requested, the input binding and limits before execution. Planning must not create an owner, start an application, install dependencies, run a model or write a cache.
4. Execute only with explicit runtime authorization. Copy eligible current sources into a unique temporary directory, excluding Git metadata, secrets, dependency directories and Forge caches. Execute finite commands with `shell:false`, bounded output and time, a restricted environment and cleanup of the process tree owned by the invocation. Source copy isolation protects the original checkout from ordinary relative writes; it is not an operating-system, network or container sandbox.
5. Collect only fresh, contained regular artifacts from the invocation. Bind hashes, command statuses, observation identities, component, source inventory, manifest, scenario, environment label and timestamps into a digest-protected report. A failed command cannot contribute successful facts. Recheck source freshness before publication and fail closed on change.
6. Save reports only with explicit `--write`. Read them without executing anything, verify structure, digest, source binding and expiration, and return a bounded context packet. File hashes establish integrity, not the authenticity or semantic correctness of a project-generated observation.
7. Expose the same operations through CLI, portable skill and MCP. `runtime-plan` is read-only, `runtime-observe` requires `--execute`/`execute:true`, and `runtime-context` is read-only. Existing static context, quality checks and model benchmarks continue to report their own limited evidence.
8. Let Agent Fabric consume compatible saved runtime evidence as an additional packet. Do not start runtime commands automatically while preparing a worker. Do not silently reuse an observation when composed upstream changes, manifest, scenario or full copied-input digest differ. Runtime context does not widen write scope or satisfy review/publication gates.
9. Test actual child-process execution, fresh artifacts, failures, timeout/cancellation, process cleanup, secret omission, stale input and report corruption. Test formats against representative generated exports and distinguish fixtures from observations of a deployed system. Run repository tests, typecheck, generator/check, framework verification and package smoke before publication.

## Manifest example

```json
{
  "forgeProtocol": "2.0",
  "kind": "repository",
  "components": [{ "id": "store", "root": "frontend-store", "adapters": ["typescript", "vue", "nuxt"] }],
  "scenario": { "id": "local-observation", "mode": "development" },
  "runtime": {
    "observations": [{
      "id": "store-generated-registry",
      "component": "store",
      "commands": [
        { "argv": ["npm", "ci", "--ignore-scripts"], "cwd": "frontend-store", "timeoutMs": 120000 },
        { "argv": ["node", "node_modules/nuxt/bin/nuxt.mjs", "prepare"], "cwd": "frontend-store", "timeoutMs": 120000 }
      ],
      "artifacts": [
        { "path": "frontend-store/.nuxt/components.d.ts", "format": "nuxt-components" },
        { "path": "frontend-store/.nuxt/imports.d.ts", "format": "nuxt-imports" }
      ]
    }]
  }
}
```

Command `cwd` is repository-relative and defaults to the observation's component root. Artifact paths are always repository-relative. Use the package manager and lockfile actually present in the project. Dependency installation is an explicit command, runs only in the copy and can require network access. Installation scripts are disabled in this example; `nuxt prepare` then runs the reviewed project configuration. On Windows, prefer a native executable or `node` plus the absolute npm CLI JavaScript path when `npm` resolves only to a `.cmd` wrapper: `shell:false` intentionally does not evaluate a command shell. Do not put tokens, passwords or environment values into argv.

Collectors do not export Spring/Docker data themselves. Declare a reviewed project script that starts the local test application if needed, exports only the intended artifacts, closes its resources and exits. A Maven/Gradle wrapper can run a project-specific integration/export task; Spring Actuator must be configured by the project for that scenario. For Docker, use a unique Compose project and an export script that tears down only its own resources in `finally`. Forge never shuts down unrelated containers or a developer's existing services.

Windows commands run in an owned Job Object. POSIX commands run in an owned process group; a program that deliberately starts another session can escape that group. Exporters must remain finite and close any detached children, servers and container resources they create. This layer does not promise containment of untrusted code.

For HTTP, export a HAR or the supported normalized request list from a test execution. Only method, sanitized path and response status enter agent context. Forge does not replay the traffic, inspect authorization headers, or infer the backend process from an unverified hostname.

## Usage from the Codex chat

```sh
forge repository runtime-plan --root /path/to/repo --environment-id local-test --json
forge repository runtime-observe --root /path/to/repo --environment-id local-test --execute --write --json
forge repository analyze --root /path/to/repo --write --json
forge repository runtime-context --root /path/to/repo --environment-id local-test --query checkout --json
```

Review the proposed manifesto and execution commands in the chat. Ask Codex to run the observation when the commands, selected scenario and external effects are authorized. No per-repository hook or MCP installation is needed for the CLI/portable skill. A configured shared Forge MCP can expose the same operations for its selected project. Updating a runtime package does not automatically activate hooks or alter global Codex configuration.

Run static analysis again after changing the manifest. Runtime context requires a current saved static snapshot and an unexpired report. Runtime commands do not update static caches implicitly. Do not change the original EasyGrow checkout to test this flow: use the dedicated pilot copy or a new independent test copy.

## Evidence and freshness

- **Nuxt declaration:** confirms a generated component/import registry for the preparation scenario; it does not prove the application rendered the component.
- **Nuxt import paths:** relative declarations can omit the source extension. They remain artifact-relative references; bare package imports and virtual aliases such as `vue` and `#app` are omitted.
- **Spring exported mappings/beans:** describes the exporter result for that invocation and profile; it does not prove every conditional request path executed.
- **Docker inspection:** describes the exported service/container state; it does not prove application health, correct credentials or production connectivity.
- **HTTP trace:** records the supplied test execution's request path/status. Origins and queries are omitted, so destination identity and parameter-dependent behavior remain limitations.
- **Normalized Forge artifact:** describes selected project-exported facts. Extra arbitrary details are excluded; this is not a general telemetry ingestion API.

The environment identifier is a human-selected label, not a fingerprint of every installed dependency, database or remote service. Reports expire and input changes invalidate them, but an external service can change sooner; collect again after changing the environment. Maps and reports remain partially complete and are aids for investigation, not a replacement for source inspection or application tests.

Reports expire after 15 minutes. The CLI/MCP plan shows a root-neutral digest of the complete eligible source copy, including dependency lockfiles and preparation scripts outside the static component globs. The static snapshot ID alone does not bind every preparation input. Runtime copy limits are 50,000 entries, 16 MiB per file and 256 MiB total; dependency and generated directories are excluded. Artifact input is limited to 2 MiB, reports to 4 MiB and command execution to five minutes total. Update the scenario when changing profiles or topology, and recollect after environment changes.

## Publication checklist

Keep alpha.69 unpublished until all validation gates and package-content checks pass. Include this document, schema and runtime modules in the package. Preserve existing alpha.69 changes and regenerate derived artifacts through the compiler. Record the current turn's logs and independent-copy pilot results separately from earlier static-map validation. Do not initiate npm authentication or publish as part of preparation.
