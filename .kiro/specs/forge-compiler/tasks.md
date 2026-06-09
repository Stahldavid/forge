# Implementation Plan: Forge Compiler & `forge add` Integration Layer (MVP)

## Overview

This plan implements the Forge Compiler in **TypeScript on the Bun runtime** (with Node fallback awareness), using **tree-sitter** for incremental AppGraph structural parsing and the **TypeScript Compiler API** (`Program`/`TypeChecker`/`ts.resolveModuleName`) for the import/export ModuleGraph and static `.d.ts` extraction. Work is sequenced bottom-up: shared types and deterministic primitives first, then the AppGraph and PackageGraph sub-compilers, package-analysis caching, the runtime-context classifier, the integration recipe registry, the package-manager adapter, the deterministic emitter and `forge.lock`, the generation orchestrator, the sandbox, `forge add` integration generation, transitive import-guard enforcement, and finally the CLI that wires everything together.

Property-based tests (library: **fast-check**) encode the design's 10 Correctness Properties and are placed close to the code they validate. Unit and integration tests use **bun test**, and emitted artifacts are validated with golden-file byte comparison. Test sub-tasks are marked optional with `*`. Every task references the current acceptance criteria in `requirements.md` (14 requirements).

## Tasks

- [ ] 1. Set up project scaffolding, tooling, and shared data models
  - [ ] 1.1 Initialize Bun + TypeScript project and dependencies
    - Create `package.json` (Bun primary, Node fallback awareness), `tsconfig.json`, and the source tree (`src/forge/compiler/`, `src/forge/cli/`, `src/forge/_generated/`)
    - Add dependencies: `tree-sitter` + TypeScript/TSX grammar, the TypeScript Compiler API, and `fast-check`; wire up `bun test`
    - Establish the `.forge/cache/` (git-ignored) and committed `src/forge/_generated/` layout from the design
    - _Requirements: 10.1_

  - [ ] 1.2 Define core shared types and data models
    - Implement the 12-value `RuntimeContext` (`shared` | `client` | `server` | `query` | `liveQuery` | `command` | `action` | `workflow` | `endpoint` | `edge` | `test` | `build`) and the tri-state `Capability`/`CapabilityStatus` (`required` | `not-detected` | `unknown` | `forbidden`) plus `CapabilitySet` (network/filesystem/process/nativeAddon/lifecycleScripts/secrets)
    - Implement `AppGraph`, `ForgeSymbol`, `ForgeEdge`, `ModuleGraph`/`ModuleNode`/`PackageImport`/`LocalImport`; `PackageGraph`, `PackageApi`, `Entrypoint`, `ExportSignature`, `ExportClassification`, `JsDoc`; `RuntimeClassification`, `SecretRequirement`; `IntegrationRecipe`/`PackageRecipe`; `PackageCacheKey`; `ForgeLock`/`ForgeLockEntry` (with `schemaVersion`/`generatorVersion`/`analyzerVersion`/`inputHash`/`packageManager`/`recipeVersion`); `EmitPlan` (with `orphanedFiles`)/`EmitFile`; and the CLI option/result types
    - _Requirements: 1.9, 4.5, 5.4, 7.1, 7.4, 8.10, 13.7, 14.1_

  - [ ] 1.3 Centralize diagnostic codes and severities
    - Implement the `Diagnostic` type and the diagnostic-code catalog: `FORGE_DUP_SYMBOL`, `FORGE_DRIFT`, `FORGE_PKG_NO_TYPES`, `FORGE_GUARD_VIOLATION`, `FORGE_SANDBOX_LIMIT`, `FORGE_SECRET_LEAK`, `FORGE_ORPHANED_GENERATED_FILE`
    - _Requirements: 1.10, 3.5, 4.6, 5.9, 9.1, 11.7, 12.4, 13.6_

- [ ] 2. Implement deterministic primitives (foundation for all output)
  - [ ] 2.1 Implement byte-wise comparison, stable sorting, and path normalization
    - Implement `compareBytes` (UTF-8 byte-sequence comparison, case-sensitive, locale-independent, ascending) over normalized POSIX-style paths/identifiers; implement stable multi-key sorts for symbols `(kind, name, file, span.start)`, edges `(from, to, kind)`, packages-by-name / entrypoints-by-subpath / exports-by-name, and emit-file paths
    - Implement workspace-relative path normalization to `/` separators
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 4.4_

  - [ ] 2.2 Implement content hashing and collision-safe stable identifiers
    - Implement `hashStable` (SHA-256 of UTF-8 content) with deterministic-header stripping so hashing/diffing ignores volatile header fields; implement the stable id `hash(kind + canonical module path + qualified name + export path)` so same-name symbols in different modules get distinct ids and identical tuples collide deterministically
    - _Requirements: 1.7, 1.9, 4.5_

  - [ ] 2.3 Implement canonical serialization and the deterministic header
    - Implement canonical JSON/text serialization: stable key ordering, arrays sorted by their natural sort basis, `\n` newline normalization, exactly one trailing `\n`
    - Implement the deterministic-header writer/parser containing generator version + input-hash + file-hash and **no timestamp**
    - _Requirements: 1.5, 1.7, 1.9, 2.6_

  - [ ]* 2.4 Write property test for stable ordering
    - **Property 4: Stable Ordering** — emitted appGraph/packageGraph byte output (including the timestamp-free header) is invariant under input-source permutation
    - **Validates: Requirements 2.4, 2.5, 2.7**

  - [ ]* 2.5 Write unit tests for comparison, hashing, headers, and serialization
    - Table-driven cases for `compareBytes` ordering, `hashStable` header-stripping, stable-id derivation, header round-trip, key ordering, newline normalization, and trailing-newline rules
    - _Requirements: 1.5, 1.7, 2.6, 4.5_

- [ ] 3. Implement the AppGraph Compiler
  - [ ] 3.1 Implement incremental parsing with multi-factor invalidation
    - Wire tree-sitter with the TypeScript/TSX grammar; reparse a file iff at least one of `contentHash`, AppGraph schema version, tree-sitter grammar version, Forge classifier version, or relevant tsconfig/compiler options changed relative to the prior AppGraph; otherwise reuse prior symbols
    - Handle unparseable files: emit a warning with the workspace-relative `/` path, exclude that file's symbols, and continue without aborting
    - _Requirements: 4.1, 4.8_

  - [ ] 3.2 Implement symbol extraction, classification, and stable ordering
    - Extract declarations and Forge builder API call-sites (`defineTable`, `query`, `command`, etc.) as symbols with workspace-relative `/` paths and byte spans; deterministically classify each into exactly one `ForgeKind` or mark unclassified (idempotent re-classification)
    - Assign collision-safe stable ids; produce an order-independent symbol set; sort symbols and edges before emission
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.7_

  - [ ] 3.3 Implement duplicate-symbol detection gate
    - On stable-id collision, emit a `FORGE_DUP_SYMBOL` warning identifying each conflicting symbol by qualified name + workspace-relative file path; continue without discarding either symbol
    - _Requirements: 4.6_

  - [ ] 3.4 Build the ModuleGraph via the TypeScript Compiler API
    - Use `Program`/`TypeChecker` to resolve import/export edges (path aliases, type-only imports, alias symbols) and populate `ModuleNode` (`directPackageImports`, `localImports`, `declaredContexts`); combine with tree-sitter structural spans
    - _Requirements: 4.9_

  - [ ]* 3.5 Write unit tests for classification, duplicates, and order independence
    - Test deterministic kind assignment, unclassified marking, stable-id derivation, `FORGE_DUP_SYMBOL`, unparseable-file warning, and symbol-set independence from source ordering
    - _Requirements: 4.3, 4.5, 4.6, 4.7, 4.8_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement the PackageGraph Compiler (static-first)
  - [ ] 5.1 Implement entrypoint resolution and the static-only guarantee
    - Resolve each declared entrypoint via TypeScript's real resolver (`ts.resolveModuleName` with `resolvePackageJsonExports`/`resolvePackageJsonImports` and `customConditions` including `"types"`) in **both** NodeNext and Bundler modes; preserve the semantic order of `exports` conditions in the resolution object
    - Enforce the static-only guarantee: never `import()`/`require()` dependency runtime code
    - _Requirements: 5.1, 5.2_

  - [ ] 5.2 Implement `.d.ts` signature extraction, JSDoc, and content checksum
    - Parse resolved `.d.ts` via the TypeScript Compiler API → one `ExportSignature` per reachable exported declaration, excluding non-exported internals; capture all overload call signatures; produce the deterministic normalized display string via the TypeChecker + normalized printer (textual equality only, no full structural-equivalence claim)
    - Capture JSDoc summary/tags/examples; compute the package `contentChecksum` from static inputs only (plus runtime shape when present), never timestamps; sort packages/entrypoints/exports
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.10_

  - [ ] 5.3 Implement subpath and pattern-backed export expansion
    - Support explicit subpath exports; mark pattern exports (`./foo/*`) as `patternBacked` and expand them only when the package file list is available and the resulting count is below the configured pattern-expansion limit
    - _Requirements: 5.8_

  - [ ] 5.4 Implement `@types/*` fallback and untyped-subpath handling
    - When a dependency ships no bundled types, attempt resolution from the corresponding `@types/*` package before reporting untyped; when a subpath cannot be resolved/parsed or has no exported types and no `@types/*` fallback resolves, emit `FORGE_PKG_NO_TYPES`, emit an adapter flagged untyped with zero `ExportSignature` entries, and continue with remaining entrypoints
    - _Requirements: 5.7, 5.9_

  - [ ]* 5.5 Write property test for static safety
    - **Property 6: Static Safety** — in static mode (`sandboxBackend: "none"`) no dependency runtime code is executed (no `import()`/`require()` of the dependency or its transitive deps)
    - **Validates: Requirements 5.2**

  - [ ]* 5.6 Write unit tests for extraction against reference-package fixtures
    - Vendored `.d.ts`/`exports` fixtures for stripe, posthog, sentry, zod, ai; assert NodeNext+Bundler resolution, signature normalization, overload capture, JSDoc capture, reachability, pattern expansion limit, `@types/*` fallback, and untyped `FORGE_PKG_NO_TYPES` fallback
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [ ] 6. Implement package analysis caching and concurrency
  - [ ] 6.1 Implement the cache keyed by the rich per-package `PackageCacheKey`
    - Store/reuse analysis keyed by name, version, package manager, package integrity (when available), `package.json` hash, `.d.ts` files hash, analyzer version, TypeScript version, resolution mode, and recipe version; on a matching key return without re-parsing `.d.ts`; on key mismatch or missing entry recompute and replace the stale entry
    - On an unreadable/failed-integrity cache entry, recompute from source, emit a warning that the entry was discarded, and continue
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 6.2 Ensure the global lockfile hash does not force whole-graph invalidation
    - When the global lockfile hash changes but a dependency's `PackageCacheKey` is unchanged, reuse that dependency's cache entry; treat `lockfileHash` as informational only
    - _Requirements: 6.6_

  - [ ] 6.3 Implement bounded-concurrency task scheduling
    - Run sub-compilers and per-package analysis concurrently with at most the configured concurrency count (integer ≥ 1; value 1 = sequential execution)
    - _Requirements: 6.7_

  - [ ]* 6.4 Write property test for cache soundness
    - **Property 5: Cache Soundness** — an unchanged `PackageCacheKey` yields a `contentChecksum` byte-identical to recompute-from-scratch, and a changed global lockfile hash alone does not force whole-graph invalidation
    - **Validates: Requirements 6.1, 6.2, 6.6**

  - [ ]* 6.5 Write unit tests for cache invalidation and concurrency bounds
    - Test recompute-on-key-mismatch, discard-on-corruption warning, lockfile-hash non-invalidation, and that no more than `concurrency` tasks run simultaneously (1 = sequential)
    - _Requirements: 6.1, 6.4, 6.5, 6.7_

- [ ] 7. Implement the Runtime-Context Classifier
  - [ ] 7.1 Implement 12-context totality classification
    - Gather signals (Node built-ins, fetch/network types, `process.env`, known rules); partition all twelve `RuntimeContext`s into disjoint `compatible`/`incompatible` sets whose union is the full universe, recording exactly one non-empty rationale per context; default insufficient-signal contexts to incompatible with rationale so none is left unclassified
    - Enforce the network rule: network egress marks `command`/`query`/`liveQuery` incompatible; ensure identical output across machines
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 7.8_

  - [ ] 7.2 Implement tri-state capability and secret detection
    - For network/filesystem/process/secrets record a `Capability` with `CapabilityStatus`, confidence, and evidence (no secret values), distinguishing `not-detected` (known absent) from `unknown` (undetermined); treat `unknown` as incompatible for `command`/`query`/`liveQuery`
    - For each required secret record env-var name, required flag, and `detectedFrom` (`jsdoc` | `signature` | `rule` | `readme` | `recipe`)
    - _Requirements: 7.4, 7.5, 7.7_

  - [ ] 7.3 Implement per-export granularity and runtime matrix output
    - Classify at per integration-alias → package → entrypoint → export granularity; record per-entrypoint detail in the runtime matrix; summarize compatibility at package level for `forge.lock`
    - _Requirements: 7.9_

  - [ ]* 7.4 Write property test for classification totality and unknown-is-incompatible
    - **Property 8: Classification Totality & Unknown-Is-Incompatible** — `compatible ∩ incompatible = ∅`, `compatible ∪ incompatible =` all 12 contexts, and any `unknown` capability ⟹ `command`/`query`/`liveQuery` ∈ `incompatible`
    - **Validates: Requirements 7.1, 7.7**

  - [ ]* 7.5 Write unit tests for determinism, the network rule, and secret detection
    - Test cross-machine determinism of compatible/incompatible/rationale, network-egress exclusion of deterministic contexts, tri-state capability evidence, and secret `detectedFrom` signals (including `recipe`)
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [ ] 8. Implement the Integration Recipe Registry
  - [ ] 8.1 Implement versioned recipes and heuristic fallback
    - Implement `resolveRecipe`/`supports`/`list` and the versioned recipes (carrying `recipeVersion`) that supply classification, capabilities, secrets, and the generated-file plan for the 5 reference aliases; apply heuristic/rule-based classification as the fallback for non-reference packages
    - _Requirements: 14.1, 14.2_

  - [ ] 8.2 Implement alias → npm-package mapping and recipe versioning
    - Map `stripe`→`["stripe"]`, `posthog`→`["posthog-js","posthog-node"]`, `sentry`→framework-dependent (`@sentry/nextjs` or `@sentry/node`+`@sentry/browser`), `zod`→`["zod"]`, `ai`→`["ai"]`; classify `ai` provider packages separately (`@ai-sdk/openai`→`OPENAI_API_KEY`, `@ai-sdk/anthropic`→`ANTHROPIC_API_KEY`); expose `recipeVersion` so the per-package cache key and `forge.lock` track recipe changes
    - _Requirements: 14.3, 14.4, 14.5_

  - [ ]* 8.3 Write unit tests for recipe resolution and mappings
    - Test reference-alias resolution, heuristic fallback for unknown aliases, the alias→package map, `ai` provider separation/secrets, and `recipeVersion` propagation
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement the Package Manager Adapter
  - [ ] 10.1 Implement PM detection, scripts-disabled install, and version detection
    - Implement the adapter over `bun`/`npm`/`pnpm`/`yarn`; detect the active PM via the `packageManager` field or lockfile presence; install with lifecycle/postinstall scripts disabled by default (enable only with `--allow-scripts`); implement `detectResolvedVersion`
    - _Requirements: 8.3, 8.4_

  - [ ] 10.2 Implement dry-run installs into a temp dir/cache
    - Implement `dryRunAdd` installing into a temp dir/cache with scripts disabled and analyzing there without modifying the workspace; provide the documented recipe-known-plan fallback
    - _Requirements: 8.13_

  - [ ]* 10.3 Write unit tests for PM detection, ignore-scripts, and dry-run
    - Test PM selection per `packageManager`/lockfile, scripts-disabled-by-default vs `--allow-scripts`, resolved-version capture, and dry-run temp-dir isolation
    - _Requirements: 8.3, 8.4, 8.13_

- [ ] 11. Implement the Deterministic Emitter and `forge.lock`
  - [ ] 11.1 Implement pure rendering, write-on-change, and atomic writes
    - Implement `render(file)` (pure: same input → same bytes) with stable ordering, fixed formatting, `\n` newlines, trailing newline, and the deterministic timestamp-free header; write only files whose freshly rendered bytes (header stripped) differ from the **actual on-disk bytes** (header stripped); write via temp file + atomic rename
    - Handle write failures: emit an error diagnostic identifying the failed path, return exit code 1, leave the recorded `Content_Hash` unchanged
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.10, 3.1_

  - [ ] 11.2 Implement check and dry-run emit modes
    - In `check` mode compare rendered bytes to on-disk bytes and write nothing (no generated files, no `forge.lock`, no manifest); in `dry-run` report would-change paths and write nothing; emit one `FORGE_DRIFT` warning per changed file with workspace-relative `/` paths
    - _Requirements: 3.1, 3.5, 10.5_

  - [ ] 11.3 Implement orphaned-generated-file cleanup
    - In write mode remove `orphanedFiles` within `src/forge/_generated/`; in check mode emit a `FORGE_ORPHANED_GENERATED_FILE` error per orphan
    - _Requirements: 13.6_

  - [ ] 11.4 Implement deterministic `forge.lock` serialization and the barrel index
    - Serialize `forge.lock` with deterministic key ordering, sorted arrays, `\n` newlines, trailing newline, and the full metadata fields (`generatorVersion`, `schemaVersion`, `analyzerVersion`, `inputHash`, `packageManager`, `recipeVersion`); emit the barrel `index.ts` re-export sorted by byte-wise ascending path order; write `forge.lock` last
    - _Requirements: 2.6, 13.2, 13.7_

  - [ ]* 11.5 Write property test for emitter determinism
    - **Property 1: Determinism** — `render(plan(S))` is byte-identical across repeated runs and machines, including the timestamp-free header
    - **Validates: Requirements 1.1, 1.3, 1.7**

  - [ ]* 11.6 Write golden-file unit tests for rendered artifacts
    - Byte-compare emitted `appGraph`, `packageGraph`, `index.ts`, and `forge.lock` against committed golden fixtures; test write-on-change, atomic-write, orphan removal, and write-failure handling
    - _Requirements: 1.5, 1.6, 1.8, 2.6, 13.2, 13.7_

- [ ] 12. Implement the Generation Orchestrator
  - [ ] 12.1 Implement discovery, planning, and stable EmitPlan assembly
    - Implement `discover` (workspace root, source globs, `package.json`, lockfile, tsconfig, input fingerprints); merge AppGraph + PackageGraph + classifier outputs into one `EmitPlan` including `orphanedFiles`; sort files by `compareBytes` path before rendering
    - _Requirements: 1.1, 2.1, 2.4_

  - [ ] 12.2 Implement the write/check pipeline, quality gates, and exit codes
    - Drive emit vs. check/dry-run; run quality gates (duplicate detection, transitive guard violations, orphan detection); in write mode update `forge.lock` and the cache manifest with every processed file's `Content_Hash`; keep changed/unchanged sets disjoint with union equal to all planned files
    - Set exit code 1 iff any error diagnostic exists or (in check mode) at least one planned file would change or at least one orphaned generated file exists; 0 otherwise
    - _Requirements: 1.4, 3.2, 3.3, 3.4, 3.6, 13.3, 13.4, 13.6_

  - [ ] 12.3 Implement lock-integrity verification
    - After a successful `generate`/`add`, verify every `forge.lock.generatedFiles` path exists; if any is missing, emit an error diagnostic identifying the path and return exit code 1
    - _Requirements: 13.1, 13.5_

  - [ ]* 12.4 Write property test for idempotency
    - **Property 2: Idempotency** — a second `generate` with no input change yields `changed === []`
    - **Validates: Requirements 1.4**

  - [ ]* 12.5 Write property test for check-equals-drift
    - **Property 3: Check Equals Drift** — `generate --check` exits 1 iff a write run would change ≥1 file, leave an orphan, or an error diagnostic exists; drift decided against actual on-disk bytes (header stripped)
    - **Validates: Requirements 1.6, 3.1, 3.6**

  - [ ]* 12.6 Write unit tests for orchestrator result invariants
    - Test disjoint/union changed-unchanged sets, manifest hash updates, check-mode no-write guarantees, and orphan-driven check failure
    - _Requirements: 3.1, 13.3, 13.4_

- [ ] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement the Sandbox (opt-in runtime inspection)
  - [ ] 14.1 Implement the none/child/docker backends with limits and env scrub
    - Implement backend `none` (default, no inspection), `child` (best-effort, trusted-only, explicitly NOT a security boundary), and `docker` (`--network none --read-only --memory <=256m --pids-limit --cap-drop ALL` with scrubbed env); enforce timeout ≤ 30000ms and memory ≤ 256MB for child/docker; keep package lifecycle scripts disabled; return only a JSON-serializable export shape (no handles/descriptors/raw memory/env values); implement the `scrubEnv` explicit allowlist removing all `.env`-sourced and secret-named values
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.9_

  - [ ] 14.2 Implement limit handling, fallback, and the strengthened secret-leak scan
    - On timeout/memory breach terminate within 1000ms, emit `FORGE_SANDBOX_LIMIT`, and fall back to static-only; on abnormal start/exit emit a warning and fall back with no partial data retained; scan the serialized result for exact secret values, secret-like keys, high-entropy patterns, and token prefixes (`sk_`/`pk_`/`ghp_`/`xoxb-`), and on a hit withhold the result, emit a `FORGE_SECRET_LEAK` error, and fall back to static-only
    - _Requirements: 11.7, 11.8, 12.3, 12.4_

  - [ ] 14.3 Enforce secret exclusion from all emitted/cached artifacts
    - Ensure the emitter, `forge.lock`, and content-hash cache exclude every `.env`/detected secret value, retaining only environment-variable names
    - _Requirements: 12.1, 12.2_

  - [ ]* 14.4 Write property test for secret exclusion
    - **Property 10: Secret Exclusion** — no `.env`/detected secret value appears in emitted/cached artifacts or inspection results; only env-var names are retained; the leak scan covers exact values, secret-like keys, high-entropy patterns, and token prefixes
    - **Validates: Requirements 12.1, 12.2, 12.3**

  - [ ]* 14.5 Write unit tests for sandbox limits, env scrubbing, and serializable output
    - Test timeout/memory termination + fallback, abnormal-start fallback, `scrubEnv` allowlist, docker flag wiring, and JSON-serializable-only output shape
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 11.8, 11.9_

- [ ] 15. Implement `forge add` integration generation
  - [ ] 15.1 Implement alias validation before install
    - Validate the alias against the Recipe Registry before installing any package; for a non-reference alias install nothing, make no change to the Generated_Directory or `forge.lock`, emit an error diagnostic, and return exit code 1
    - _Requirements: 8.1, 8.2_

  - [ ] 15.2 Implement the transactional snapshot/restore of version-controlled files
    - Snapshot `package.json`, the active lockfile, `forge.lock`, and the generated manifest before installing; on any failure after modifying a snapshotted file (including install resolution/download failure) restore those files to their pre-add contents and return exit code 1
    - _Requirements: 8.5, 8.6, 8.14_

  - [ ] 15.3 Install via the adapter and record the resolved version
    - Install the reference package through the Package Manager Adapter (active PM detected) and record the resolved exact version for `forge.lock`
    - _Requirements: 8.3_

  - [ ] 15.4 Analyze and classify the installed package
    - Run the PackageGraph Compiler to extract the API and the Runtime Classifier to classify runtime contexts, capabilities, and secret requirements
    - _Requirements: 8.7_

  - [ ] 15.5 Emit runtime-scoped adapters, guards, matrix, testkits, and docs
    - Build the integration plan and emit runtime-scoped typed adapters, `importGuards.{ts,json}`, `runtimeMatrix.{ts,json}`, `testkits/*.mock.ts`, and per-integration `docs/*.md`, omitting adapter variants for incompatible contexts and recording each incompatibility in the runtime matrix
    - _Requirements: 8.8, 8.9_

  - [ ] 15.6 Write the `forge.lock` entry with names-only secrets
    - On successful add (package installed and every planned file written), write a `forge.lock` entry with package version, runtime contexts, capabilities, secrets, generated file paths, content checksum, and `recipeVersion`; store only env-var names for secrets
    - _Requirements: 8.10, 8.11_

  - [ ] 15.7 Route `--runtime-inspect` through the Sandbox and implement `--dry-run`
    - Perform runtime inspection only through the Sandbox when `--runtime-inspect` is set (default off); for `--dry-run` install into a temp dir/cache with scripts disabled and analyze there without modifying the workspace (or the documented recipe-known-plan fallback)
    - _Requirements: 8.12, 8.13_

  - [ ]* 15.8 Write property test for lock integrity and transactional rollback
    - **Property 9: Lock Integrity** — after a successful add/generate every `forge.lock.generatedFiles` path exists, and after a transactional `forge add` failure all snapshotted version-controlled files are restored unchanged
    - **Validates: Requirements 8.6, 13.1**

  - [ ]* 15.9 Write integration tests for `forge add` against vendored fixtures
    - End-to-end add for stripe, posthog, sentry, zod, ai; assert emitted files, omitted incompatible adapters (e.g. stripe → `stripe.server.ts`, no `stripe.command.ts`), runtime-matrix entries, names-only secrets (e.g. `["STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET"]`), `recipeVersion`, and non-reference rejection
    - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.8, 8.9, 8.10, 8.11_

- [ ] 16. Implement transitive import-guard enforcement
  - [ ] 16.1 Implement `checkImportGuards` over the ModuleGraph
    - Propagate each Forge entrypoint's `RuntimeContext` over the local ModuleGraph (`effectiveContexts`); emit exactly one `FORGE_GUARD_VIOLATION` error per (package import, effective context) pair iff that context is in the package's incompatible set; return zero diagnostics when all imports are compatible; skip packages absent from the runtime matrix; apply narrower-context-wins for multi-context modules; include package name, violating context, rationale, workspace-relative file path, and character span
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_

  - [ ] 16.2 Implement the ESLint plugin and CI consumer
    - Build an ESLint rule and CI consumer that read the generated `importGuards.json` and `runtimeMatrix.json` (not the `.ts` variants) and report guard violations; make `forge check` exit 1 on any `FORGE_GUARD_VIOLATION`
    - _Requirements: 9.1, 9.4, 9.5_

  - [ ]* 16.3 Write property test for transitive guard soundness
    - **Property 7: Transitive Guard Soundness** — for every module `m` reaching context `c` (directly or transitively) and every direct package import `p` in `m`, an error is emitted iff `c ∈ classify(p).incompatible`; a multi-context helper must satisfy every effective context
    - **Validates: Requirements 9.1, 9.6**

  - [ ]* 16.4 Write unit tests for guard diagnostics and unmanaged-package skip
    - Test the transitive stripe-in-command violation, span/rationale payload, narrower-context-wins, and skipping packages absent from the matrix
    - _Requirements: 9.2, 9.3, 9.5, 9.6_

- [ ] 17. Implement and wire the CLI surface
  - [ ] 17.1 Implement command parsing and the generate/add/inspect/check commands
    - Wire `forge generate`, `forge generate --check`, `forge add <alias>`, `forge inspect app|packages|capabilities|runtime-matrix`, and `forge check` to the orchestrator, integration generator, and guard checker; reject unsupported inspect targets (listing supported targets) and unrecognized commands/options with an error and exit code 1
    - _Requirements: 10.1, 10.2, 10.3, 10.7_

  - [ ] 17.2 Implement output modes, exit codes, and dual-format generation
    - Implement `--json` (exactly one valid JSON document, all diagnostics inside, no human logs on stdout, with a semantic `failureKind`), `--dry-run` (report would-change paths, write nothing), and the global exit-code rule (1 iff any error diagnostic, else 0); generate both `.ts` and `.json` for `importGuards`/`runtimeMatrix`
    - _Requirements: 9.4, 10.4, 10.5, 10.6_

  - [ ]* 17.3 Write unit tests for CLI parsing, output modes, and exit codes
    - Test `--json` validity + `failureKind`, `--dry-run` no-write, unsupported-target/unrecognized-command handling, and check/guard exit codes
    - _Requirements: 9.4, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 18. Final integration and end-to-end wiring
  - [ ] 18.1 Wire all components end-to-end and verify reliability invariants
    - Connect CLI → Orchestrator → AppGraph/PackageGraph compilers, classifier, recipe registry, PM adapter, emitter, sandbox, and guard checker; ensure the committed `_generated/` round-trips through `forge generate --check`
    - _Requirements: 10.1, 13.1, 13.3, 13.4_

  - [ ]* 18.2 Write end-to-end integration tests for the full pipeline
    - Transitive guard e2e (command → helper → stripe → `FORGE_GUARD_VIOLATION`); transactional rollback e2e; orphan-cleanup e2e (`FORGE_ORPHANED_GENERATED_FILE`); docker sandbox network-block e2e (falls back to static); `--check` drift e2e (mutate a generated file → exit 1)
    - _Requirements: 3.2, 8.6, 9.1, 11.3, 13.5, 13.6_

- [ ] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Property-based tests use **fast-check** and encode the design's 10 Correctness Properties; each property sub-task is annotated with its property number and the current `requirements.md` acceptance-criteria clauses it validates, and sits next to the implementation it validates so regressions surface early.
- Unit and integration tests use **bun test**; emitted artifacts are validated with golden-file byte comparison.
- Checkpoints provide incremental validation breaks; each task references specific requirement clauses for traceability.
- The ESLint plugin and CI consume `importGuards.json` and `runtimeMatrix.json`; the `.ts` variants are emitted for DX/type-safety.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.1", "5.1", "7.1", "8.1", "10.1"] },
    { "id": 4, "tasks": ["3.2", "5.2", "7.2", "8.2", "10.2"] },
    { "id": 5, "tasks": ["3.3", "3.4", "5.3", "6.1", "7.3", "8.3", "10.3"] },
    { "id": 6, "tasks": ["3.5", "5.4", "6.2", "6.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["5.5", "5.6", "6.4", "6.5", "11.1"] },
    { "id": 8, "tasks": ["11.2"] },
    { "id": 9, "tasks": ["11.3", "11.4"] },
    { "id": 10, "tasks": ["11.5", "11.6", "12.1"] },
    { "id": 11, "tasks": ["12.2", "14.1"] },
    { "id": 12, "tasks": ["12.3", "14.2", "14.3"] },
    { "id": 13, "tasks": ["12.4", "12.5", "12.6", "14.4", "14.5"] },
    { "id": 14, "tasks": ["15.1", "15.2", "15.4", "16.1"] },
    { "id": 15, "tasks": ["15.3", "15.5", "16.2"] },
    { "id": 16, "tasks": ["15.6", "15.7", "16.3", "16.4"] },
    { "id": 17, "tasks": ["15.8", "15.9", "17.1"] },
    { "id": 18, "tasks": ["17.2"] },
    { "id": 19, "tasks": ["17.3", "18.1"] },
    { "id": 20, "tasks": ["18.2"] }
  ]
}
```
