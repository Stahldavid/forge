# Repository manifests and maps

Use Forge as analysis tooling in an existing project without adding the Forge application
runtime. Shared installation is enough. Vue/Nuxt, Java/Spring, TypeScript/JavaScript and
Docker/Compose adapters report their coverage; partial static knowledge remains partial.

Run these with the absolute installed skill helper and an explicit target directory:

```text
node <skill>/scripts/repository.mjs --project <project> manifest discover --json
node <skill>/scripts/repository.mjs --project <project> manifest validate forge.manifest.json --json
node <skill>/scripts/repository.mjs --project <project> repository analyze --write --json
node <skill>/scripts/repository.mjs --project <project> repository context --query routes --json
node <skill>/scripts/repository.mjs --project <project> repository context --query coverage --json
node <skill>/scripts/repository.mjs --project <project> repository quality --cases <absolute-reviewed-cases.json> --json
node <skill>/scripts/repository.mjs --project <project> cair query "Q S name=<symbol>" --snapshot-id <snapshot-id> --json
```

Discovery is read-only by default: it returns a draft for the agent to review and save within the
user's authorized scope. Confirm component roots and adapters against actual files,
retain uncertainty, and do not overwrite a service 1.0 manifest. Repository manifests
use `forgeProtocol: "2.0"` and `kind: "repository"`. Keep paths relative to the project.
The manifest configures analysis; it is not a hand-maintained symbol inventory.

Validate before analyzing. Analysis with `--write` saves explicit output to `.forge/repository/`
unless a host-local cache destination is requested. Without `--write`, analysis returns
an ephemeral snapshot and creates no cache. It does not alter
generated application code, `.gitignore`, application dependencies or global integrations.
Use `--help` for supported flags and current query grammar. Query results identify the
snapshot and source evidence; a stale-source diagnostic requires fresh analysis.

The helper binds `--project` explicitly for repository operations and CAIR. For a manifest
kept outside the project, add `--manifest <absolute-file>` consistently to analysis and
queries. Its location does not redefine the project root. Do not substitute another
project's snapshot or leave out the external manifest when querying that snapshot.

Do not read actual `.env` or secret files to resolve infrastructure. Unknown interpolation,
dynamic URLs, Java reflection, Vue dynamic components and unresolved imports are gaps,
not permission to infer certainty. A Compose dependency is declared topology, not observed
traffic. A statically associated test is not proof that it ran or covered the component.

For Fabric, keep analysis configuration in the project before run-start. Each SDK attempt
analyzes its prepared clone after upstream changes and environment preparation. Clone
snapshot IDs cannot be substituted with the original checkout's snapshot. Maps do not
remove required reviews/checks, execute suggested checks, or authorize publication.
Worker packets prioritize task matches and scoped symbols, include both endpoints of
every returned edge, and declare truncation when their context budget omits facts.
Their phase is `prepared-input`, not an assertion about later worker edits. Invalid
configuration yields unavailable maps without echoing manifest source values in run status.

Use optional `component.analysis.aliases` and `component.analysis.nuxt` to declare
contained local resolution paths that executable config cannot establish statically.
These paths are relative to the component root. `httpClients` may map a client ID
(including `$api`) and file scope to a literal base path/API component. Record the
scenario behind a mapping: a deployment default is declared evidence and never
observed routing. Keep unknown URLs and ambiguous endpoints unresolved.

Task context prioritizes exact/scoped targets, relevant consumers and case-level
test evidence. A test-file import does not associate all sibling cases with that
function. Included neighbors outside write scope are read-only. Suggested checks
retain argv arrays, working directories, selection reasons, cost/category and
unknown/missing/satisfied symbolic requirements; no check runs during map preparation.
`ready` means the packet was prepared. Static quality is always partial and does not
claim runtime observation.

For quality review, prepare a JSON task array with `id`, `query`, `expectedFiles`
and optionally `scope`, `expectedTests`, `forbiddenFiles` and `forbiddenTests`.
Run `repository quality` against a current explicitly saved snapshot. It returns
missing/forbidden associations, context size, truncation and recall/precision against
the supplied expected file set. Require a reviewed set; do not remove failing
expectations merely to obtain a pass. This read-only benchmark runs no models or
application tests and cannot establish productivity improvement or executed coverage.

Large v2 caches use hash-checked partitions and on-demand hydration, with complete
integrity validation and a two-partition decoded cache. V1 compatibility is eager;
wide queries may retain extra results. Analysis with --write maintains orphan caches
after conservative retention; cache-gc defaults to preview and --write applies it.
Never reclaim a foreign lock or treat serialized resident bytes as heap usage.
Use benchmark-plan with reviewed cases and explicit model settings to prepare a paired
experiment; benchmark-report evaluates supplied evidence without running workers/checks.
Missing evidence is unknown, and model execution still requires authorized cost/scope.
Matching parse facts can be reused read-only in a managed clone, but its graph,
root, manifest/scenario connections and freshness are rebuilt. No per-project
dependency, native hook or MCP installation is required for this flow. These features
require a runtime containing the quality implementation; copying a newer skill onto
an older runtime does not upgrade that runtime.

Runtime observations are optional and explicit. Add reviewed `runtime.observations`
with commands, contained cwd and generated artifact paths, then use `repository
runtime-plan --environment-id local --json` before `runtime-observe --environment-id
local --execute --write --json`. The latter executes trusted argv in an independent
temporary source copy; it is not an OS/network/container security sandbox. Dependencies
must be prepared by declared commands. Do not copy credentials or assume external
services are authorized merely because a manifest mentions them. No model runs here.
`runtime-context` reads sanitized bounded evidence, validates input bindings and expiry,
and never executes. Nuxt registrations, Spring exports, Docker inspection and HTTP
traces retain their format-specific limitations; they are not exhaustive runtime coverage.
Exporters must close external resources they start. No hook or MCP installation is needed
per project. Fabric can add matching saved observations to a prepared worker packet
without running an exporter; composed input changes invalidate this reuse. Keep original
protected repositories read-only and use the dedicated pilot copies for validation.
See `docs/repository-runtime-observation.md` for the contract and execution examples.
