# Repository context quality for Agent Fabric

Forge can map an existing repository without converting it into a Forge application. The Codex chat remains the interface; a repository manifesto declares the analysis boundary and optional checks. Analysis reads source and static configuration. It does not evaluate Nuxt/Vite configuration, start Docker, install packages, call remote APIs or execute the checks.

## Implementation plan and boundaries

1. Capture a managed baseline and editable task scope. Carry readonly descriptors/lockfiles with the captured input. Preserve source changes outside that scope.
2. Apply upstream artifacts in an isolated clone and prepare its authorized environment. Regenerate repository context from that prepared clone, rather than reusing the source snapshot. Bind the clone identity, source digests, manifest and scenario to the snapshot.
3. Resolve static alias and Nuxt declarations inside each component. Give explicit manifesto declarations precedence where automatic static discovery cannot resolve dynamic configuration. Keep unresolved or ambiguous references visible; avoid inventing imports from names alone.
4. Link local HTTP client calls to routes only with supporting evidence: known client declaration, literal method/path and compatible API component. Preserve unresolved calls when hosts, path construction or multiple candidates make the connection uncertain.
5. Select graph context relevant to the task's files/nodes/components. Preserve snapshot binding, paths, locations, relation evidence and gaps when truncating. The snapshot retains source hashes; the compact packet refers back to it. A compact packet must say what was omitted.
6. Select relevant declared checks and explain why. Include their original argv, explicit working directory, cost/category and requirement status. The selector does not authorize or execute them.
7. Report preparation, freshness, coverage and relation assurance separately. Verify the final clone packet with fixtures for Nuxt, HTTP clients, partial graphs and check relevance. A paid agent run and a real application test require their own evidence.

Changes to the manifesto are optional extensions of protocol `2.0`, kind `repository`. Existing components, checks and the executable service protocol `1.0` retain their previous contracts. Missing extensions do not mean a framework feature is unsupported; they mean no extra declaration was supplied.

## Static analysis declarations

```json
{
  "forgeProtocol": "2.0",
  "kind": "repository",
  "components": [
    {
      "id": "web",
      "root": "web",
      "adapters": ["vue", "nuxt"],
      "analysis": {
        "aliases": { "@": "src", "~": "src" },
        "nuxt": {
          "rootDir": ".",
          "srcDir": "src",
          "components": ["src/components"],
          "imports": ["src/composables"]
        }
      }
    },
    { "id": "api", "root": "api", "adapters": ["java", "spring"] }
  ],
  "httpClients": [
    {
      "id": "apiClient",
      "component": "web",
      "files": ["src/services/**"],
      "basePath": "/api",
      "apiComponent": "api"
    }
  ],
  "checks": [
    {
      "id": "web-typecheck",
      "component": "web",
      "argv": ["npm", "--prefix", "web", "run", "typecheck"],
      "files": ["src/**"],
      "category": "typecheck",
      "cost": "low",
      "requires": ["node"]
    },
    {
      "id": "api-integration",
      "component": "api",
      "cwd": "api",
      "argv": ["./mvnw", "verify"],
      "category": "integration",
      "cost": "high",
      "requires": ["java", "docker", "network"]
    }
  ]
}
```

All `analysis` paths, alias targets and HTTP client `files` are relative to `component.root`. In particular, `srcDir` is relative to the component root, **not** to `rootDir`. Component roots remain repository-relative. These declarations provide a static interpretation; they do not promise complete Nuxt runtime equivalence.

Aliases have at most 100 entries. Names are bounded to 128 characters, reject traversal segments and prototype keys, and map to contained relative paths. Nuxt declarations accept only `rootDir`, `srcDir`, `components` and `imports`; each directory list has at most 100 entries. Unknown fields, scripts, absolute paths, Windows streams, backslashes, control characters and `..` segments are rejected. Consumers must preserve physical containment and refuse symlink traversal when reading resolved files.

An HTTP client `id` identifies the local variable/function used by the source adapter, such as `apiClient`, `$fetch` or `axios`. IDs are unique within their component and have at most 80 characters. `files` scopes that declaration to component-relative files/globs. `apiComponent` names an existing component and scopes possible route targets; it is an explicit declaration, not proof that a call reaches that service at runtime. `basePath` contains only a literal URL path beginning with `/`, at most 2048 characters. Origins, credentials, query strings, fragments, percent escapes and traversal are rejected. The manifesto never contains headers, environment values, credentials or executable client configuration.

The runtime validator also checks component references and duplicate identities. JSON Schema validates structure and bounds; reference/identity checks remain the runtime validator's responsibility. Manifest files retain the existing 256 KiB reading limit.

## Check relevance contract

`selectRepositoryChecks(snapshot, task)` is a pure selection API. `task` accepts optional repository-relative `scope`, exact `nodeIds`, component IDs and caller-reported `capabilities`. It returns `checks`, `diagnostics` and `execution: "not-executed"`. The caller should pass a freshly validated snapshot; the pure selector itself does not read files or verify freshness.

Checks retain required `id`, `component` and `argv`. Optional fields are:

| Field | Meaning |
| --- | --- |
| `cwd` | Repository-relative working directory. Omitted means `.`; old argv with `--prefix web` keeps its original interpretation. |
| `files` | Component-relative files/globs limiting relevance. Empty/omitted means component-wide. This is not permission to edit those files. |
| `category` | `typecheck`, `test`, `lint`, `build`, `integration`, `security` or `other`. |
| `cost` | Declared `low`, `medium` or `high`; low-cost declarations sort first. No cost is measured or presumed free. |
| `requires` | Up to 32 unique symbolic capability names, such as `java`, `docker` or `network`. No values or environment assignments. |

A component is relevant when explicitly selected, touched by task scopes/nodes, or directly adjacent to a selected node through a complete declared/resolved edge. Inferred or unresolved edges do not automatically expand check selection. File-limited checks must overlap a relevant file or scope, unless the user explicitly selected the whole component. Directory/glob scopes conservatively include future/unindexed files. This may suggest extra checks; it does not prove those checks cover the task.

Every suggestion contains reasons such as `task-component:web`, `task-node-component:web`, `related-node-component:api`, `task-scope-overlaps-component`, `check-files-match-task` or `check-files-overlap-scope`. Unknown node/component references produce diagnostics. Unsafe task scopes or invalid manifests return no suggestions. Empty task selectors return no suggestions.

Requirements report `satisfied` when there are no requirements or the caller explicitly reports all of them; `missing` when the caller's capability list omits required entries; and `unknown` when capabilities were not provided. The selector never probes executables, reads environment variables or infers network authorization. Even `satisfied` means only the declaration was satisfied by caller-provided information, not that the command ran successfully.

The consumer must show argv as an array, without shell concatenation, and retain `execution: "not-executed"`. A future execution tool must separately bind the checkout, validate physical cwd containment, apply environment/network/cost authorization and record exit status/output against the input digest. A check named `test` is not evidence until it actually executes successfully on the relevant bytes.

## Context quality contract

`ready` describes whether a usable packet was prepared. `prepared-input` describes the clone phase from which that packet was generated. Neither describes semantic completeness or successful application verification.

A packet should expose these independent dimensions:

| Dimension | Required interpretation |
| --- | --- |
| Preparation | Absent/invalid manifest, unavailable analyzer, successful packet or bounded failure. Errors must remain visible. |
| Input phase | Source, composed upstream input or prepared input, with clone identity and snapshot binding. |
| Freshness | Source/config/manifest inventory matches the analyzed snapshot, or stale/mismatch status. |
| Coverage | Found/analyzed/ignored/unsupported/error counts and visible limitations. |
| Relation assurance | Declared, syntactic, resolved or inferred, together with complete/partial/unresolved resolution. |
| Budget | Packet truncation and omitted context. A small packet is not the entire graph. |
| Verification | Suggested checks versus independently observed execution results. |

Avoid reducing these dimensions to one percentage or a generic “complete” flag. For example, a prepared-input packet can be fresh and usable while Java reflection, Nuxt runtime injection or dynamic HTTP URLs remain unresolved. Explicit manifesto hints improve navigation but remain declared evidence.

## Validation and remaining limits

### Case-level test evidence

Test suites and executable cases are separate nodes. Importing a module establishes a `test-file-depends-on` edge between files; it does not associate every case in that file with every imported function. `test-references` means a reference inside that case's callback. `test-exercises` means a statically resolved call, including named import aliases and bounded same-file helper chains (three levels, at most 128 visited nodes). Both carry `observedCoverage: false`. A conventional test filename supplies navigation only. Test queries follow precise associations and exclude unrelated sibling cases.

### Static Nuxt and HTTP resolution

Literal Nuxt `rootDir`, `srcDir`, aliases, component directories and import directories are read through the syntax tree. Executable expressions remain unknown. Component and composable candidates come only from scanned local files, and multiple candidates remain ambiguous. External UI packages, module-generated imports, layers and runtime injection can remain unresolved. Manifest analysis paths provide contained, explicit overrides. TypeScript compiler aliases and explicit relative imports keep their precedence.

HTTP analysis recognizes immutable local constants, bounded templates, Axios and `$fetch` factories, Nuxt-provided clients and simple returned-call wrappers across imports. A template can additionally retain a separate path pattern when each unknown placeholder occupies a whole segment and comes from a numeric parameter or an encoded scalar parameter. The URL remains dynamic; only a unique compatible endpoint can become a partial candidate link. Dynamic hosts/query strings, embedded or unbounded string expressions and ambiguous routes remain unresolved. Calls belong to the nearest containing function or arrow, including calls initializing local response variables. An absolute external origin needs an explicit API-component declaration before it can become a local service association. Unknown runtime base URLs and document-relative URLs remain unresolved. Manifest client mappings carry declared evidence with `runtimeRoutingVerified: false`; they cannot establish what a deployed reverse proxy or environment actually does.

### Task retrieval and write scope

`selectRepositoryContext` uses deterministic ranking for exact symbols, IDs and paths, normalized English/Portuguese task terms and declared write scope. Exact targets suppress expansion through generic instruction verbs. The selector reserves space for actual consumers and precise tests, then follows at most two relevant graph hops, including function-to-HTTP-call-to-endpoint paths. Shared test files and imports are not bridges to unrelated cases. Java call sites are grouped for broad locate queries; expanding a group requires its snapshot binding.

Each selected node includes location, assurance, selected metadata, selection reasons and `access: write-scope | read-only`. Neighbor inclusion never changes the scope. Relations and groups retain their endpoints when the packet is truncated. Node/edge counts, character budgets and omitted counts are explicit. Fabric uses a 10,000-character selection budget and a 16,000-character packet budget, includes relevant check argv/cwd as informational data, and records static quality in run metadata. Preparation failures report `unavailable`, including failures after successful analysis.

### Partitioned cache and prepared clones

Analyzer version `1.2.1` invalidates incompatible parse facts. Small snapshots retain legacy JSON storage. Large graphs use a bounded index plus content-addressed, hash-checked partitions; source facts are partitioned by file. Snapshot storage v2 partitions preserve canonical ID order, enabling sequential validation and scans. V1 component partitions remain readable through the eager compatibility path. Publication uses the existing analysis lock and an atomic header rename, so an incomplete write does not publish an incomplete graph. Readers reject corrupt, oversized, missing or unsafe partitions.

The v2 reader builds compact ID/position and relation indexes, then hydrates nodes/edges on demand through array-compatible read-only collections. A two-partition LRU limits retained decoded partitions within that cache. Full integrity, structure, root ownership and canonical fingerprint validation still reads every current partition before exposing the graph; source freshness is checked separately as before. Streaming canonical JSON hashing avoids building a second complete graph and serialization string. Relation sorting uses compact summaries, and budget-impossible neighbors are rejected before hydration. `repositoryStorageMetrics(snapshot)` reports actual partition reads/bytes and peak **serialized resident payload**, not decoded heap. Candidate lists, broad query results and callers retaining nodes can consume additional memory; this is not a promise of constant memory for arbitrary queries or a database with a full-text index. Returned node objects retain the previous mutable data contract, while partition-backed arrays reject mutations.

Successful `repository analyze --write` performs conservative cache maintenance automatically. Identical published headers remain stable apart from the creation time of a new in-memory result; unchanged cache generations keep their original `createdAt`. The first warm run may update reuse statistics. Library callers can disable maintenance with `cacheCleanup: false`. A maintenance failure preserves the successful publication and exposes `REPOSITORY_CACHE_CLEANUP_DEFERRED`; it never reclaims a foreign lock.

`repository cache-gc --json` previews cleanup; adding `--write` applies it. The collector preserves all current snapshot/fact references, validates them before mutation, rejects symlinked inventories and journals first-observed orphan identities. Default retention is 24 hours (`--grace-hours 1..720`), with a one-hour minimum. It deletes only chunks continuously observed orphaned through that window. Any header replacement restarts the window conservatively; frequent changing inputs may delay reclamation. Readers that remain alive beyond the configured grace need external coordination or longer retention. Unknown regular files are retained. This command manages generated cache chunks only and never deletes repository source.

Managed clones may reuse read-only source parse facts only when path, component, adapter, analyzer version and source digest match. The graph is rebuilt for the actual clone, current manifest and scenario. A changed source file is reparsed. Facts do not supply source-root graph identities or relax the clone freshness check, and preparation writes no analysis cache in the clone. This is an optimization within the host user's trust boundary, not a sandbox against a malicious host user.

### Reviewed task benchmark

Create a reviewed JSON array of 1–100 tasks. Names and file paths are bounded and duplicate identities/expectations are rejected. Include required files/tests and explicitly forbidden associations:

```json
[
  {
    "id": "seo-homologation",
    "query": "Corrigir validação SEO em homologação",
    "scope": ["web/utils/seoEnvironment.ts"],
    "expectedFiles": ["web/utils/seoEnvironment.ts", "web/nuxt.config.ts", "tests/seo.test.ts"],
    "expectedTests": ["unsafe SEO in homologation"],
    "forbiddenTests": ["unrelated checkout price"]
  }
]
```

After explicitly creating the current analysis cache, run from the target repository:

```text
node <forge-runtime>/bin/forge.mjs repository quality --cases <absolute-reviewed-cases.json> --json
```

The command reads current snapshots, rejects stale source evidence, and never executes checks or agents. Exit zero means every supplied expectation passed; one means a benchmark/validation failure. Reports show missing/forbidden results, context characters, truncation, recall and precision against the declared file set. That precision is meaningful as total retrieval precision only when the reviewed set is exhaustive; legitimate undeclared neighbors lower it. A passing fixture is not proof that all repository relationships are resolved. Synthetic regression tasks cover SEO, checkout, scheduling, Vue consumers and frontend-to-Java HTTP links.

The paired agent experiment is implemented as a planner and evidence evaluator: `repository benchmark-plan --cases tasks.json --model-config model.json --repetitions 2 --json`, followed by `repository benchmark-report --plan plan.json --observations observations.json --json`. The planner binds identical prompts, scopes, models/settings and declared checks to source, manifest, scenario and snapshot identity; only the map packet differs between arms. The report accepts observed token/latency/source-read metrics, artifact-bound independent review and authorized check results. Missing evidence remains unknown and metric differences require comparable completed pairs. Neither command executes a model or an application check, and exit zero on a valid pending report is not an experiment success. See [the runner protocol](repository-agent-benchmark.md) for JSON contracts, counterbalancing and the external authorization boundary. No productivity results are claimed without actual runs.

Fixtures cover legacy/new manifesto validation, JSON Schema structure, traversal/unknown fields, declaration bounds, scoped HTTP identities, check selection by files/nodes/components, missing/unknown requirements and unchanged argv/cwd interpretation. Integration must additionally prove that the Fabric packet is rebuilt after upstream composition and environment preparation, and that source/manifest changes invalidate reused context.

Static repository analysis is not a Nuxt build, Java compiler, Docker scenario execution, network trace or production test. Same-user clones isolate ordinary edits but are not a security sandbox against an adversarial process with access to the host. Source repository publication and paid Codex workers remain governed by the existing Fabric workflow. EasyGrow validation must run only in a dedicated copy; its original repositories remain read-only.
