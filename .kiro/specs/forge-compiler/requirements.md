# Requirements Document

## Introduction

This document specifies the requirements for the MVP vertical slice of ForgeOS: the **Forge Compiler** and the package-aware **`forge add`** generated integration layer. The Forge Compiler is a deterministic, content-hash-cached code generation engine that reads an application's TypeScript/TSX sources, its `package.json`, lockfile, and tsconfig, and installed package type declarations, then emits a source-controlled `src/forge/_generated/` directory.

The system is composed of three sub-compilers feeding one generation orchestrator: an **AppGraph Compiler** (incremental Tree-sitter structural parsing plus TypeScript Compiler API import/export resolution and semantic classification of project sources), a **PackageGraph Compiler** (static-first dependency/API extraction via TypeScript's real module resolver with opt-in sandboxed runtime inspection), and the **`forge add`** integration generator (typed adapters, import guards, runtime matrix, testkits, docs, and a semantic lockfile), driven by versioned integration recipes. Cross-cutting concerns — determinism, security, performance, and reliability — are first-class requirements.

Committed output is **fully deterministic**: generated artifacts and `forge.lock` contain no timestamps or other volatile fields, and reproducibility relies on deterministic fields (`schemaVersion`, `generatorVersion`, `analyzerVersion`, `inputHash`). Timestamps may appear only in runtime execution logs, never in committed output.

The requirements in this document are derived from the approved design document and provide testable acceptance criteria that the design's ten Correctness Properties map back to.

## Glossary

- **Forge_Compiler**: The overall code generation engine comprising all sub-compilers, the orchestrator, the emitter, and the CLI.
- **Generation_Orchestrator**: The component that coordinates the discover → parse → analyze → classify → plan → emit → verify pipeline and produces the `EmitPlan`.
- **AppGraph_Compiler**: The component that incrementally parses project TypeScript/TSX sources with Tree-sitter, resolves the import/export graph with the TypeScript Compiler API, extracts symbols, builds the ModuleGraph, and classifies symbols into Forge semantic kinds.
- **PackageGraph_Compiler**: The component that statically extracts a dependency's API from resolved `.d.ts` files, `package.json` `exports`, and JSDoc using TypeScript's real module resolver, with optional sandboxed runtime inspection.
- **Runtime_Classifier**: The component that maps a package API to compatible and incompatible Forge runtime contexts and detects capabilities and secret requirements, driven by integration recipes plus heuristics.
- **Deterministic_Emitter**: The component that renders an `EmitPlan` to bytes deterministically, writes changed files atomically, removes orphaned generated files, and updates `forge.lock`.
- **Sandbox**: The opt-in runtime export inspection component, with selectable backend `none` (default, static-only), `child` (best-effort, trusted packages only), or `docker` (recommended isolation).
- **Sandbox_Backend**: One of `none`, `child`, or `docker`.
- **Import_Guard_Checker**: The component (consumed by the ESLint plugin and `forge check`) that detects direct and transitive package imports into incompatible runtime contexts by propagating runtime contexts over the ModuleGraph.
- **Forge_CLI**: The user/CI entrypoint exposing `forge generate`, `forge add`, `forge inspect`, and `forge check`.
- **Package_Manager_Adapter**: The component that abstracts over `bun`, `npm`, `pnpm`, and `yarn` for installs, dry-run installs, and resolved-version detection, detecting the active package manager via the `packageManager` field or lockfile presence and disabling lifecycle scripts by default.
- **Integration_Recipe**: An explicit, versioned definition (carrying a `recipeVersion`) that maps an integration alias to one or more real npm packages and curates that alias's classification, capabilities, secrets, adapters, testkits, docs, and optional import rewrites.
- **Recipe_Registry**: The component that resolves an integration alias to an Integration_Recipe and reports whether an alias is supported.
- **Generated_Directory**: The committed `src/forge/_generated/` output directory.
- **forge.lock**: The semantic lockfile recording per-package version, runtime contexts, capabilities, secrets, generated files, content checksums, and deterministic metadata (`schemaVersion`, `generatorVersion`, `analyzerVersion`, `inputHash`, `packageManager`, `recipeVersion`).
- **ModuleGraph**: The local module import graph of the project's own sources, where each node records its direct package imports, local imports, declared runtime contexts, and effective runtime contexts propagated transitively from importing Forge entrypoints.
- **ExportClassification**: The per integration-alias → package → entrypoint → export record of compatible and incompatible runtime contexts and capabilities for a single export.
- **Capability**: A tri-state determination for a single capability dimension (e.g. network, filesystem, process, secrets), carrying a `CapabilityStatus`, a confidence level (`manual`, `rule`, `static`, or `runtime`), and supporting evidence with no secret values.
- **CapabilityStatus**: One of `required`, `not-detected`, `unknown`, or `forbidden`, where `not-detected` means known-absent and `unknown` means undetermined.
- **Deterministic_Header**: The leading header prefixed to every generated file, containing the generator version, the input hash, and the file content hash, and containing no timestamp.
- **Content_Hash**: A SHA-256 hash of UTF-8 content computed after stripping the Deterministic_Header, used as a cache key and change-detection key.
- **Runtime_Context**: One of `shared`, `client`, `server`, `query`, `liveQuery`, `command`, `action`, `workflow`, `endpoint`, `edge`, `test`, or `build`.
- **Deterministic_Context**: The narrower deterministic server contexts `command`, `query`, and `liveQuery`.
- **Forge_Kind**: One of `schema.table`, `query`, `liveQuery`, `command`, `endpoint`, `policy`, `workflow`, `agent`, `telemetryEvent`.
- **Reference_Package**: One of the five MVP-supported integration aliases backed by versioned recipes: `stripe`, `posthog`, `sentry`, `zod`, `ai`.
- **Drift**: A difference between a planned file's freshly rendered bytes (after stripping the Deterministic_Header) and the actual on-disk bytes of the corresponding Generated_Directory file, or the absence of a planned file on disk, or the presence of an orphaned generated file.
- **Orphaned_Generated_File**: A file previously emitted under `src/forge/_generated/` that is no longer present in the current `EmitPlan`.
- **Check_Mode**: The CI verification mode invoked via `forge generate --check`, which writes no files.
- **Static_Mode**: PackageGraph analysis (Sandbox_Backend `none`) that reads only resolved `.d.ts` files, `exports`, JSDoc, and README without executing any package code.

## Requirements

### Requirement 1: Deterministic Code Generation

**User Story:** As a developer, I want `forge generate` to produce fully deterministic, content-controlled output, so that generated code is reproducible across runs and machines and reviewable in version control.

#### Acceptance Criteria

1. WHEN `forge generate` is invoked in write mode (invoked with neither `--check` nor `--dry-run`), THE Generation_Orchestrator SHALL write the Generated_Directory and forge.lock so their on-disk bytes are identical to the rendered EmitPlan.
2. WHEN the Deterministic_Emitter renders the same EmitPlan twice, THE Deterministic_Emitter SHALL produce byte-identical output, including the Deterministic_Header.
3. WHEN the Forge_Compiler runs with identical project state on different machines, THE Deterministic_Emitter SHALL produce byte-identical output, including the Deterministic_Header.
4. WHEN `forge generate` is invoked a second time with no change to the project TypeScript/TSX sources, `package.json`, lockfile, or tsconfig, THE Generation_Orchestrator SHALL report a changed-files set with zero entries.
5. WHEN the Deterministic_Emitter renders any generated file, THE Deterministic_Emitter SHALL use stable key ordering, normalize all line endings to `\n`, and end the file with exactly one trailing `\n`.
6. WHEN the Deterministic_Emitter writes generated files, THE Deterministic_Emitter SHALL write only files whose freshly rendered bytes, after stripping the Deterministic_Header, differ from the actual on-disk bytes of the corresponding file after stripping the Deterministic_Header.
7. WHEN the Deterministic_Emitter renders any generated file, THE Deterministic_Emitter SHALL prefix the file with the Deterministic_Header containing the generator version, the input hash, and the file Content_Hash, and SHALL NOT include any timestamp in the header.
8. WHEN the Deterministic_Emitter writes a generated file, THE Deterministic_Emitter SHALL write the rendered bytes to a temporary file in the same directory and atomically rename that temporary file into place, and SHALL update forge.lock after all generated files are written.
9. WHEN the Forge_Compiler emits any committed artifact, THE Forge_Compiler SHALL exclude timestamps and other volatile fields from the Generated_Directory files and forge.lock, and SHALL record reproducibility metadata using the deterministic fields `schemaVersion`, `generatorVersion`, `analyzerVersion`, and `inputHash`.
10. IF writing a generated file or forge.lock fails in write mode, THEN THE Generation_Orchestrator SHALL emit an error-severity diagnostic identifying the failed path, return exit code 1, and leave the recorded Content_Hash for that path unchanged.

### Requirement 2: Stable Ordering of Generated Output

**User Story:** As a developer, I want generated graphs and files to be ordered independently of input ordering, so that incidental source ordering never causes spurious diffs.

#### Acceptance Criteria

1. WHEN the Generation_Orchestrator builds the EmitPlan, THE Generation_Orchestrator SHALL sort emitted files into ascending order before rendering using the ordering basis defined in criterion 7.
2. WHEN the AppGraph_Compiler emits symbols, THE AppGraph_Compiler SHALL sort symbols by the ordered key `(kind, name, file, span.start)` before emission.
3. WHEN the AppGraph_Compiler emits edges, THE AppGraph_Compiler SHALL sort edges by the ordered key `(from, to, kind)` before emission.
4. WHERE input source files are provided in any ordering, THE Forge_Compiler SHALL produce byte-identical appGraph and packageGraph output, including the Deterministic_Header, for all permutations of the same input set.
5. WHEN the PackageGraph_Compiler emits its graph, THE PackageGraph_Compiler SHALL sort packages by name, entrypoints by subpath, and exports by name.
6. WHEN the Deterministic_Emitter serializes forge.lock, THE Deterministic_Emitter SHALL order object keys deterministically, sort array elements by their natural sort basis, normalize line endings to `\n`, and end the file with exactly one trailing `\n`.
7. WHEN the Forge_Compiler orders paths or identifiers for emission, THE Forge_Compiler SHALL order them by UTF-8 byte-sequence comparison over normalized POSIX-style paths and identifiers, case-sensitive and locale-independent, in ascending order.
8. WHEN the PackageGraph_Compiler resolves a package `exports` field, THE PackageGraph_Compiler SHALL preserve the semantic order of `exports` conditions in the resolution object and SHALL apply sorting only to the emitted output.

### Requirement 3: CI Verification and Drift Detection

**User Story:** As a CI maintainer, I want a check mode that fails when generated output is stale, so that committed generated code stays in sync with sources.

#### Acceptance Criteria

1. WHEN `forge generate --check` is invoked, THE Generation_Orchestrator SHALL compare each planned file's freshly rendered bytes, after stripping the Deterministic_Header, to that file's actual on-disk bytes after stripping the Deterministic_Header, and SHALL NOT write any generated file, forge.lock, or the cache manifest, treating the cache manifest as an optimization rather than the source of truth for Drift.
2. IF Check_Mode detects at least one planned file whose rendered bytes differ from its on-disk bytes or that is absent from disk, THEN THE Generation_Orchestrator SHALL return exit code 1.
3. IF Check_Mode detects at least one error-severity diagnostic, THEN THE Generation_Orchestrator SHALL return exit code 1.
4. WHEN a check run completes with no Drift and no error-severity diagnostic, THE Generation_Orchestrator SHALL return exit code 0.
5. IF Check_Mode detects a planned file whose rendered bytes differ from its on-disk bytes or that is absent from disk, THEN THE Generation_Orchestrator SHALL emit one `FORGE_DRIFT` warning diagnostic per such file, each listing the workspace-relative file path using `/` separators.
6. WHILE in Check_Mode, THE Generation_Orchestrator SHALL return exit code 1 if and only if at least one planned file would change in a write run, at least one Orphaned_Generated_File exists, or at least one error-severity diagnostic exists, and SHALL return exit code 0 otherwise.

### Requirement 4: AppGraph Incremental Parsing and Classification

**User Story:** As a developer, I want my project sources parsed into a classified AppGraph and ModuleGraph, so that the compiler can drive codegen, impact analysis, and quality gates.

#### Acceptance Criteria

1. WHEN the AppGraph_Compiler processes a source file, THE AppGraph_Compiler SHALL reparse that file if and only if at least one of the following changed relative to the prior AppGraph: the file Content_Hash, the AppGraph schema version, the Tree-sitter grammar version, the Forge classifier version, or the relevant tsconfig/compiler options.
2. WHEN the AppGraph_Compiler parses sources, THE AppGraph_Compiler SHALL extract declarations and call-sites of Forge builder APIs as symbols.
3. WHEN the AppGraph_Compiler extracts a symbol, THE AppGraph_Compiler SHALL deterministically classify it into exactly one Forge_Kind, or mark it as unclassified when the symbol matches no Forge_Kind, such that classifying the same symbol again yields the identical result.
4. WHEN the AppGraph_Compiler records a symbol file path, THE AppGraph_Compiler SHALL store it as a workspace-relative path using `/` separators.
5. WHEN the AppGraph_Compiler assigns a stable identifier to a symbol, THE AppGraph_Compiler SHALL derive the stable identifier from a hash of the symbol kind, canonical module path, qualified name, and export path, such that two symbols sharing a name in different modules receive distinct stable identifiers and identical `(kind, canonical module path, qualified name, export path)` tuples yield identical stable identifiers.
6. IF two symbols produce the same stable identifier, THEN THE AppGraph_Compiler SHALL emit a `FORGE_DUP_SYMBOL` warning diagnostic that identifies each conflicting symbol by its qualified name and workspace-relative file path, and SHALL continue generation without discarding either symbol.
7. WHEN the AppGraph_Compiler returns its symbol set for a given content state, THE AppGraph_Compiler SHALL produce a symbol set that is independent of source file ordering.
8. IF the AppGraph_Compiler cannot parse a source file, THEN THE AppGraph_Compiler SHALL emit a warning diagnostic identifying the workspace-relative path of the unparseable file, exclude that file's symbols from the AppGraph, and continue processing the remaining source files without aborting generation.
9. WHEN the AppGraph_Compiler processes project sources, THE AppGraph_Compiler SHALL build a ModuleGraph using the TypeScript Compiler API for import/export resolution, including path aliases, type-only imports, and alias symbols, in addition to Tree-sitter structural parsing.

### Requirement 5: PackageGraph Static-First API Extraction

**User Story:** As a developer, I want package APIs extracted statically from type declarations, so that I get typed integration data without executing untrusted package code.

#### Acceptance Criteria

1. WHEN the PackageGraph_Compiler analyzes a dependency in Static_Mode, THE PackageGraph_Compiler SHALL resolve each declared entrypoint using TypeScript's real module resolver (`ts.resolveModuleName` with `resolvePackageJsonExports` and `resolvePackageJsonImports` enabled and `customConditions` including `"types"`) in both NodeNext and Bundler resolution modes, and SHALL parse the resolved `.d.ts` file for each resolved entrypoint.
2. WHILE operating in Static_Mode, THE PackageGraph_Compiler SHALL NOT execute any dependency runtime code, including via `import()` or `require()` of the dependency or its transitive dependencies.
3. WHEN the PackageGraph_Compiler extracts an export signature, THE PackageGraph_Compiler SHALL produce a deterministic, stable normalized display string via the TypeChecker plus a normalized printer with best-effort safe alias expansion, SHALL treat two textually-equal normalized strings as equal, and SHALL NOT claim full semantic structural equivalence for all TypeScript types.
4. WHEN the PackageGraph_Compiler processes an entrypoint, THE PackageGraph_Compiler SHALL produce exactly one ExportSignature per declaration exported and reachable from that entrypoint and SHALL exclude declarations not exported from that entrypoint.
5. WHEN the PackageGraph_Compiler extracts an export that declares multiple TypeScript call signatures, THE PackageGraph_Compiler SHALL capture all of those signatures in the resulting ExportSignature.
6. WHEN the PackageGraph_Compiler extracts an export that has associated JSDoc, THE PackageGraph_Compiler SHALL capture its summary, tags, and usage examples in the resulting ExportSignature.
7. WHEN the PackageGraph_Compiler encounters a dependency that ships no bundled type declarations, THE PackageGraph_Compiler SHALL attempt to resolve types from the corresponding `@types/*` package before reporting the entrypoint as untyped.
8. WHEN the PackageGraph_Compiler resolves package `exports`, THE PackageGraph_Compiler SHALL support explicit subpath exports and SHALL mark pattern exports (e.g. `./foo/*`) as pattern-backed, expanding them only when the package file list is available and the resulting count is below the configured pattern-expansion limit.
9. IF a subpath declared in `exports` cannot be resolved to a file, or its resolved `.d.ts` file cannot be parsed, or its resolved file contains no exported type declarations, and no `@types/*` fallback resolves types, THEN THE PackageGraph_Compiler SHALL emit a `FORGE_PKG_NO_TYPES` warning diagnostic, emit an adapter for that subpath flagged as untyped with zero ExportSignature entries, and continue analysis of the remaining entrypoints without a hard failure.
10. WHEN the PackageGraph_Compiler computes a package content checksum, THE PackageGraph_Compiler SHALL derive it only from static inputs and, when runtime inspection is used, the runtime export shape, and SHALL NOT include timestamps or other volatile values.

### Requirement 6: Package Analysis Caching

**User Story:** As a developer, I want package analysis cached by a rich per-package key, so that repeated generation is fast and consistent without over-invalidating on unrelated lockfile changes.

#### Acceptance Criteria

1. WHEN the PackageGraph_Compiler analyzes a dependency, THE PackageGraph_Compiler SHALL store the analysis result in the cache keyed by the per-package key comprising the package name, version, package manager, package integrity (when available), `package.json` hash, `.d.ts` files hash, analyzer version, TypeScript version, resolution mode, and recipe version (when applicable).
2. WHILE a dependency's per-package key is unchanged from the matching cache entry, THE PackageGraph_Compiler SHALL return a result whose content checksum is byte-identical to the content checksum produced by recomputing the analysis from scratch.
3. WHEN a cache entry exists for an unchanged per-package key, THE PackageGraph_Compiler SHALL reuse the cached result without re-parsing any `.d.ts` files for that dependency.
4. IF any component of a dependency's per-package key differs from its cache entry, or no cache entry exists for the dependency, THEN THE PackageGraph_Compiler SHALL recompute the analysis from source inputs and replace any stale cache entry with the recomputed result.
5. IF a cache entry for a dependency cannot be read or fails integrity validation, THEN THE PackageGraph_Compiler SHALL recompute the analysis from source inputs, emit a warning diagnostic indicating the cache entry was discarded, and continue without failing the run.
6. WHEN the global lockfile hash changes while a dependency's per-package key is unchanged, THE PackageGraph_Compiler SHALL reuse that dependency's cache entry and SHALL NOT invalidate the whole package graph on the global lockfile hash change alone.
7. WHEN the Generation_Orchestrator runs sub-compilers and per-package analysis, THE Generation_Orchestrator SHALL execute them concurrently with at most the configured concurrency count of tasks running simultaneously, where the configured concurrency count is an integer of 1 or greater and a value of 1 causes tasks to execute sequentially.

### Requirement 7: Runtime-Context Classification

**User Story:** As a developer, I want each package export classified by which runtime contexts it is compatible with, so that the system can gate imports and choose which adapter variants to emit.

#### Acceptance Criteria

1. WHEN the Runtime_Classifier classifies a package API, THE Runtime_Classifier SHALL partition the twelve Runtime_Contexts (`shared`, `client`, `server`, `query`, `liveQuery`, `command`, `action`, `workflow`, `endpoint`, `edge`, `test`, `build`) into disjoint `compatible` and `incompatible` sets whose union equals all twelve Runtime_Contexts.
2. WHEN the Runtime_Classifier classifies a package API, THE Runtime_Classifier SHALL record exactly one non-empty rationale entry for each of the twelve Runtime_Contexts.
3. WHEN the Runtime_Classifier classifies the same package API on the same or a different machine, THE Runtime_Classifier SHALL produce identical `compatible` sets, `incompatible` sets, and rationale entries.
4. WHEN the Runtime_Classifier detects capabilities, THE Runtime_Classifier SHALL record, for each of the network, filesystem, process, and secrets capability dimensions, a Capability carrying a CapabilityStatus of `required`, `not-detected`, `unknown`, or `forbidden`, a confidence of `manual`, `rule`, `static`, or `runtime`, and supporting evidence, distinguishing `not-detected` (known absent) from `unknown` (undetermined).
5. WHEN the Runtime_Classifier detects secret requirements, THE Runtime_Classifier SHALL record, for each required secret, the environment-variable name, the required flag, and the detected-from source signal constrained to one of `jsdoc`, `signature`, `rule`, `readme`, or `recipe`.
6. WHEN a package API performs network egress, THE Runtime_Classifier SHALL mark the `command`, `query`, and `liveQuery` Deterministic_Contexts as incompatible.
7. IF a capability has CapabilityStatus `unknown`, THEN THE Runtime_Classifier SHALL mark the `command`, `query`, and `liveQuery` Deterministic_Contexts as incompatible.
8. IF the available signals are insufficient to determine compatibility for a Runtime_Context, THEN THE Runtime_Classifier SHALL default that Runtime_Context to incompatible with a recorded rationale so that no Runtime_Context is left unclassified.
9. WHEN the Runtime_Classifier classifies a package API, THE Runtime_Classifier SHALL classify at per integration-alias → package → entrypoint → export granularity, record the per-entrypoint detail in the runtime matrix, and summarize compatibility at package level in forge.lock.

### Requirement 8: Package Integration via `forge add`

**User Story:** As a developer, I want `forge add <alias>` to install and integrate a package end to end transactionally, so that I get typed adapters, guards, mocks, docs, and a recorded lock entry in one safe step.

#### Acceptance Criteria

1. WHEN `forge add <alias>` is invoked, THE Forge_CLI SHALL validate the integration alias against the Recipe_Registry before installing any package.
2. IF `forge add <alias>` is invoked with an alias that is not a Reference_Package, THEN THE Forge_CLI SHALL install no package, make no change to the Generated_Directory or forge.lock, emit an error-severity diagnostic, and return exit code 1.
3. WHEN `forge add <alias>` proceeds for a Reference_Package, THE Forge_CLI SHALL install the package through the Package_Manager_Adapter, which SHALL detect the active package manager among `bun`, `npm`, `pnpm`, and `yarn` via the `packageManager` field or lockfile presence, and SHALL record the resolved exact version in forge.lock.
4. WHEN `forge add <alias>` installs a package, THE Package_Manager_Adapter SHALL disable dependency lifecycle and postinstall scripts by default, unless the user passes `--allow-scripts`.
5. WHEN `forge add <alias>` begins, THE Forge_CLI SHALL snapshot the version-controlled files `package.json`, the active lockfile, `forge.lock`, and the generated manifest before installing.
6. IF any step of `forge add <alias>` fails after modifying any snapshotted version-controlled file, THEN THE Forge_CLI SHALL restore those files to their pre-add contents and return exit code 1.
7. WHEN `forge add <alias>` analyzes the installed package, THE PackageGraph_Compiler SHALL extract its API and THE Runtime_Classifier SHALL classify its runtime contexts, capabilities, and secret requirements.
8. WHEN `forge add <alias>` generates output, THE Deterministic_Emitter SHALL emit runtime-scoped typed adapters, import guards, the runtime matrix, testkits/mocks, and a per-integration document.
9. WHERE a package is incompatible with a given Runtime_Context, THE Deterministic_Emitter SHALL omit the adapter variant for that context and record the incompatibility in the runtime matrix.
10. WHEN `forge add <alias>` completes successfully (the package is installed and every planned file is written), THE Deterministic_Emitter SHALL update forge.lock with an entry containing the package version, runtime contexts, capabilities, secrets, generated file paths, content checksum, and recipe version.
11. WHEN `forge add <alias>` records secret requirements, THE Deterministic_Emitter SHALL store only environment-variable names in forge.lock.
12. WHERE the `--runtime-inspect` option is provided, THE PackageGraph_Compiler SHALL perform runtime export inspection only through the Sandbox.
13. WHERE the `--dry-run` option is provided, THE Forge_CLI SHALL install into a temporary directory or cache with lifecycle scripts disabled and analyze there without modifying the workspace, or, as a documented fallback, report the recipe-known plan and note that `.d.ts` analysis requires a real install.
14. IF the package installation fails because the package cannot be resolved or downloaded, THEN THE Forge_CLI SHALL emit an error-severity diagnostic, restore the snapshotted version-controlled files, and return exit code 1.

### Requirement 9: Import-Guard and Runtime-Matrix Enforcement

**User Story:** As a developer, I want imports of packages into incompatible runtime contexts to be blocked, including transitively, so that I cannot place network-bound packages into deterministic contexts.

#### Acceptance Criteria

1. WHEN the Import_Guard_Checker evaluates package imports, THE Import_Guard_Checker SHALL evaluate both direct and transitive package imports by propagating each Forge entrypoint's Runtime_Context over the local ModuleGraph, and SHALL emit exactly one `FORGE_GUARD_VIOLATION` error-severity diagnostic for a (package import, effective Runtime_Context) pair if and only if that effective Runtime_Context is in the package's incompatible set.
2. WHEN every package import in the evaluated sources occurs only in effective Runtime_Contexts that are in that package's compatible set, THE Import_Guard_Checker SHALL return zero diagnostics.
3. WHEN the Import_Guard_Checker encounters an import of a package absent from the runtime matrix, THE Import_Guard_Checker SHALL skip that import without emitting a diagnostic.
4. IF `forge check` detects at least one `FORGE_GUARD_VIOLATION`, THEN THE Forge_CLI SHALL return exit code 1.
5. WHEN a `FORGE_GUARD_VIOLATION` is emitted, THE Import_Guard_Checker SHALL include the package name, the violating Runtime_Context, the incompatibility rationale text, the workspace-relative source file path, and the character span (start and end offsets) of the offending import.
6. WHEN a module is reachable from multiple Runtime_Contexts, THE Import_Guard_Checker SHALL validate that module's package imports against every effective Runtime_Context, such that the narrower context wins.

### Requirement 10: CLI Surface and Output Modes

**User Story:** As a developer and CI maintainer, I want a consistent CLI with machine-readable output and CI exit codes, so that I can run the compiler interactively and in automation.

#### Acceptance Criteria

1. THE Forge_CLI SHALL provide the commands `forge generate`, `forge generate --check`, `forge add <alias>`, `forge inspect`, and `forge check`.
2. WHEN `forge inspect <target>` is invoked with a target of `app`, `packages`, `capabilities`, or `runtime-matrix`, THE Forge_CLI SHALL produce the inspection output for that target and return exit code 0.
3. IF `forge inspect <target>` is invoked with an unsupported target, THEN THE Forge_CLI SHALL produce no inspection output, emit an error indicating the supported targets, and return exit code 1.
4. WHERE the `--json` option is provided, THE Forge_CLI SHALL write exactly one valid JSON document to standard output with no non-JSON text on standard output, SHALL include all diagnostics within that JSON document, and SHALL NOT write human-readable logs to standard output.
5. WHERE the `--dry-run` option is provided, THE Forge_CLI SHALL report the list of workspace-relative paths it would create or modify and SHALL NOT create, modify, or delete any file in the workspace.
6. WHEN a Forge_CLI command completes, THE Forge_CLI SHALL return exit code 1 if any error-severity diagnostic exists and exit code 0 otherwise, and WHERE the `--json` option is provided THE Forge_CLI SHALL additionally report a semantic failure kind within the JSON document.
7. IF the Forge_CLI is invoked with an unrecognized command or option, THEN THE Forge_CLI SHALL emit an error indicating the invalid usage and return exit code 1.

### Requirement 11: Sandboxed Runtime Inspection

**User Story:** As a security-conscious developer, I want runtime inspection to be opt-in and isolated, so that inspecting a package cannot harm my system or exfiltrate data.

#### Acceptance Criteria

1. WHERE no Sandbox_Backend is selected, THE Sandbox SHALL default to backend `none` and perform no runtime inspection, relying entirely on static analysis.
2. WHERE the Sandbox_Backend is `child` or `docker`, THE Sandbox SHALL execute the inspection with a timeout of at most 30000ms and a memory cap of at most 256MB.
3. WHERE the Sandbox_Backend is `docker`, THE Sandbox SHALL run the inspection with network disabled, a read-only filesystem, the configured memory cap, a process-count limit, all Linux capabilities dropped, and a scrubbed environment.
4. WHERE the Sandbox_Backend is `child`, THE Sandbox SHALL restrict runtime inspection to trusted, already-installed packages and SHALL document the `child` backend as a best-effort mechanism that is not a security boundary for untrusted packages.
5. WHILE the Sandbox is active, THE Sandbox SHALL keep package lifecycle scripts disabled such that no package-defined script executes.
6. WHEN the Sandbox returns a result, THE Sandbox SHALL return only a JSON-serializable export shape and SHALL exclude non-JSON-serializable values, process handles, file descriptors, raw memory, and environment values.
7. IF runtime inspection exceeds its timeout or memory cap, THEN THE Sandbox SHALL terminate the child process within 1000ms of the breach, emit a `FORGE_SANDBOX_LIMIT` warning, and fall back to the static-only result.
8. IF the child process fails to start or terminates abnormally, THEN THE Sandbox SHALL emit a warning diagnostic and fall back to the static-only result with no partial runtime data retained.
9. WHEN the Sandbox prepares the child or docker environment, THE Sandbox SHALL pass only an explicit allowlist of variables and remove all `.env`-sourced and secret-named values, such that no removed value appears in the returned result.

### Requirement 12: Secret Protection in Generated Artifacts

**User Story:** As a security-conscious developer, I want secrets excluded from all generated and cached artifacts, so that no credential is ever committed or indexed.

#### Acceptance Criteria

1. WHEN the Forge_Compiler emits or caches any artifact (Generated_Directory files, forge.lock, or content-hash cache entries), THE Forge_Compiler SHALL exclude every `.env` value and detected secret value from that artifact's bytes.
2. WHEN the Forge_Compiler records a detected secret, THE Forge_Compiler SHALL retain only the environment-variable name and SHALL NOT write its value.
3. WHEN the Sandbox serializes an inspection result, THE Sandbox SHALL scan the serialized result against exact known secret values, secret-like keys, high-entropy patterns, and known token prefixes (including `sk_`, `pk_`, `ghp_`, and `xoxb-`).
4. IF the secret-leak scan finds a secret value, secret-like key, high-entropy pattern, or known token prefix in a serialized inspection result, THEN THE Sandbox SHALL withhold the result, emit an error-severity diagnostic, and fall back to the static-only result.

### Requirement 13: Reliability of Committed Generated Output

**User Story:** As a maintainer, I want the lockfile and generated output to remain internally consistent, so that the committed state is trustworthy and CI can rely on it.

#### Acceptance Criteria

1. WHEN `forge add` or `forge generate` completes successfully, THE Forge_Compiler SHALL verify that every path listed in `forge.lock.generatedFiles` exists on disk.
2. WHEN the Forge_Compiler emits the Generated_Directory, THE Deterministic_Emitter SHALL emit a barrel `index.ts` re-export whose entries are sorted using the ordering basis defined in Requirement 2 criterion 7.
3. WHEN the Generation_Orchestrator completes a write run, THE Generation_Orchestrator SHALL update the cache manifest to reflect the Content_Hash of every processed file.
4. WHEN the Generation_Orchestrator completes a write run, THE Generation_Orchestrator SHALL set the result so that the changed and unchanged file sets are disjoint and their union equals the full set of planned files.
5. IF a path listed in `forge.lock.generatedFiles` is missing on disk after a completed run, THEN THE Forge_Compiler SHALL emit an error-severity diagnostic identifying the missing path and return exit code 1.
6. IF an Orphaned_Generated_File exists, THEN THE Forge_Compiler SHALL emit a `FORGE_ORPHANED_GENERATED_FILE` error-severity diagnostic and return exit code 1 in Check_Mode, and SHALL remove the Orphaned_Generated_File in write mode.
7. WHEN the Deterministic_Emitter serializes forge.lock, THE Deterministic_Emitter SHALL include the `generatorVersion`, `schemaVersion`, `analyzerVersion`, `inputHash`, `packageManager`, and `recipeVersion` metadata fields.

### Requirement 14: Integration Recipe Registry

**User Story:** As a developer, I want the five reference integrations driven by explicit, versioned recipes, so that classification, capabilities, secrets, and generated files come from curated knowledge rather than pure heuristics.

#### Acceptance Criteria

1. WHEN `forge add <alias>` integrates a Reference_Package, THE Recipe_Registry SHALL supply the classification, capabilities, secrets, and generated-file plan for that alias from an explicit, versioned Integration_Recipe carrying a `recipeVersion`.
2. WHEN the Runtime_Classifier classifies a package that is not a Reference_Package, THE Runtime_Classifier SHALL apply heuristic and rule-based classification as the fallback.
3. WHEN the Recipe_Registry resolves an integration alias, THE Recipe_Registry SHALL map the alias to one or more real npm packages, mapping `stripe` to `["stripe"]`, `posthog` to `["posthog-js", "posthog-node"]`, `sentry` to a framework-dependent set (`@sentry/nextjs` or `@sentry/node` plus `@sentry/browser`), `zod` to `["zod"]`, and `ai` to `["ai"]`.
4. WHEN the Recipe_Registry resolves the `ai` alias, THE Recipe_Registry SHALL classify provider packages separately from the `ai` core package, mapping `@ai-sdk/openai` to the secret `OPENAI_API_KEY` and `@ai-sdk/anthropic` to the secret `ANTHROPIC_API_KEY`.
5. WHEN an Integration_Recipe changes, THE Recipe_Registry SHALL expose the updated `recipeVersion` so that the per-package cache key and forge.lock entry track the recipe change.
