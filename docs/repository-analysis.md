# Forge maps in existing repositories

Optional [runtime observation](repository-runtime-observation.md) supplements static maps
with explicitly executed, source-bound generated artifacts. Review `runtime-plan`, opt in
with `runtime-observe --execute`, and read current evidence with `runtime-context`.
Static analysis remains free of implicit project execution.

Large snapshot storage uses canonical-order v2 partitions and on-demand graph
hydration, with eager compatibility for v1. Published analysis performs conservative
cache maintenance. Use `forge repository cache-gc --json` to preview it, and `--write`
to apply after retention (24 hours by default). Checks/models remain unexecuted.
See [context quality and cache contracts](repository-context-quality.md) and
[paired agent benchmark](repository-agent-benchmark.md) for the detailed guarantees.

Forge repository analysis produces static maps and compact agent context without migrating
the application to Forge's runtime. Vue/Nuxt, Java/Spring, TypeScript/JavaScript and
Docker/Compose can coexist in one repository manifest. Analysis is available without Git;
managed Agent Fabric workflows require a Git repository with an initial commit.

## Prepare a manifest with Codex

Ask the Codex agent to prepare the project for Forge maps. Discovery returns a draft;
the agent checks component roots and frameworks against project instructions and source,
then saves the manifest within the authorized edit scope. Discovery does not overwrite
an existing service manifest.

From the target project, using an absolute shared runtime path:

```text
node <forge-runtime>/bin/forge.mjs manifest discover --json
node <forge-runtime>/bin/forge.mjs manifest validate forge.manifest.json --json
node <forge-runtime>/bin/forge.mjs repository analyze --write --json
node <forge-runtime>/bin/forge.mjs repository context --query routes --json
node <forge-runtime>/bin/forge.mjs repository context --query infrastructure --json
node <forge-runtime>/bin/forge.mjs repository context --query coverage --json
node <forge-runtime>/bin/forge.mjs repository quality --cases <absolute-reviewed-cases.json> --json
```

Discovery without `--write` and validation are read-only. Analysis with `--write` explicitly produces local artifacts;
no application generation, runtime dependency, hook installation, Docker startup or Java
build is required. The runtime does not need to reside in the target repository. Use
`--root` for an explicit target, including directories without package.json or Git.

Repository manifests use protocol 2.0 and a repository discriminator. Service manifests
using protocol 1.0 remain separate executable contracts and retain compatibility.

```json
{
  "forgeProtocol": "2.0",
  "kind": "repository",
  "components": [
    { "id": "web", "root": "frontend", "adapters": ["vue", "typescript"] },
    { "id": "api", "root": "backend", "adapters": ["java", "spring", "maven"] },
    { "id": "infra", "root": ".", "adapters": ["docker"], "files": ["compose.yaml", "backend/Dockerfile"] }
  ],
  "checks": [{ "id": "web-tests", "component": "web", "argv": ["npm", "test"] }]
}
```

The manifest describes analysis configuration, not every function. Roots and files are
relative to the target project. Checks are suggestions and never run during discovery,
analysis or queries. `.forge/fabric.json` continues to configure managed execution;
repository manifest checks do not override explicit workflow acceptance obligations.

## Understand evidence and coverage

The graph records nodes, relations, locations, source hashes, adapter versions and
assurance (`declared`, `syntactic`, `resolved`, `inferred`). The coverage report describes
ignored and unsupported files, diagnostics, unresolved behavior and adapter limitations.

Vue maps expose components, script symbols and visible bindings. Java maps expose syntax,
Spring endpoints and build declarations. Docker maps expose declared builds and Compose
topology. None of these constitute observed runtime behavior: a port is not a health check,
`depends_on` is not proof of traffic, and static test association is not executed coverage.
Dynamic configuration, Java reflection and Vue autoimports can remain unresolved.
Static Nuxt aliases, local autoimports and supported HTTP clients have additional
resolution paths. Ambiguous candidates remain visible. Test associations are case-level;
sharing a test file does not establish that all cases exercise an imported symbol.
See [repository context quality](repository-context-quality.md) for the declaration
schema, retrieval rules, cache limits and reviewed task benchmark.

Local TypeScript/JavaScript config inheritance, project references, baseUrl and path aliases
are read statically inside the selected repository. Package-provided executable configuration
and external inheritance remain unresolved. Vue conditional template branches are included;
Docker instructions continued across physical lines are joined before extraction.

Real `.env` files and credential files are excluded. Unknown environment interpolation
remains unknown. Analysis does not run scripts, executable config, Gradle/Maven wrappers,
Docker or arbitrary external adapters. Source snippets are not emitted by default.

## Query current snapshots

Queries include overview, locate, symbol, references, routes, dependencies, impact, tests,
infrastructure and coverage. Use exact node IDs to disambiguate repeated names. Compact
symbol handles are local to a snapshot and require its snapshotId; they cannot be carried
to a new snapshot. Sources changed after analysis make the result stale. Reanalyze before
requesting definitions or applying map evidence to a task.

Repository context accepts `--limit` from 1 to 100 and `--max-chars` from 2048 to 50000.
The same limits apply to MCP context tools. MCP analysis returns bounded coverage samples
with omitted counts; saved snapshots retain the complete analysis report. Cached graphs are
validated for structure, identity, containment and source provenance before queries.

Artifacts normally reside in `.forge/repository/`, outside generated application code.
No `.gitignore` is edited automatically. A host-local cache can keep outputs outside the
project. Omit `--write` when only an ephemeral analysis result is authorized. Parsing
reuse is based on content hashes; graph identity also includes manifest and scenario.

The CAIR repository provider serves read queries. Runtime-specific or mutating CAIR
actions are unavailable for this provider. An impact map describes potential dependencies
and does not authorize skipping required tests.

## Use with Agent Fabric

Install the personal Forge Agent Fabric skill once. Its `scripts/repository.mjs` helper
uses the installed shared runtime with an explicit target directory and does not require
Git. The original `scripts/fabric.mjs` helper retains the Git requirement for execution.
No per-project runtime dependency, hook or MCP installation is required for maps.

When a managed SDK attempt contains a valid repository manifest, Fabric analyzes its
prepared clone after composing upstream artifacts and preparing dependencies. A bounded
packet contains scoped nodes and edges, coverage limitations, clone snapshot identity and
suggested checks with argv/cwd, reasons and requirement status. Task neighbors are
read-only unless already inside write scope. Static quality counters remain partial;
`ready` means the packet was prepared. The run status records source project and clone identities separately,
with phase `prepared-input`; it does not claim the same map describes subsequent worker edits.
Reviewers receive a fresh snapshot of the combined upstream changes, not the map from the
original checkout. Matching parse facts can be reused from the source cache while graph
identity and connections are rebuilt for the clone. Analysis writes no cache into managed clones.

A missing manifest leaves existing workflows unchanged. Invalid configuration or
unavailable analysis is reported as unavailable; the worker must inspect current code
directly. It never receives a purported fallback graph from another checkout. Maps do not
alter write scopes, independent review, explicit command verification or publication gates.
Publication still means applying scoped local changes, not Git push, npm or deployment.

MCP queries can use projects registered with Fabric; select the project explicitly.
Each root and snapshot remain distinct, including separate Windows/WSL copies. Cross-project
queries do not assert a simultaneous global snapshot or automatically synchronize checkouts.
