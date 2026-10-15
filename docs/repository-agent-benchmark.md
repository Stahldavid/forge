# Repository agent benchmark

Forge can prepare a reproducible experiment with and without repository maps, then
evaluate evidence supplied by an external runner. Planning and evaluation are pure:
they do not invoke Codex, read source files, execute application checks, install dependencies,
or grant permission to spend credits. A static retrieval fixture passing is useful evidence
about a packet, but does not demonstrate improved model productivity.

## Prepare a paired plan

The CLI validates cache ownership, graph integrity and current source freshness before
planning. Save its complete JSON output; reporting accepts either that `{plan, ok,
exitCode}` envelope or the bare API plan. A model config contains only `provider`,
`name` and scalar `settings`, with no credentials:

```text
forge repository benchmark-plan --cases tasks.json --model-config model.json --repetitions 2 --json
forge repository benchmark-report --plan plan.json --observations observations.json --json
```

The model name is selected explicitly for the experiment, never inferred from the app.
Planning/reporting are read-only. `--write` is rejected. A valid report with no observations
has zero comparable pairs and pending results; CLI exit zero confirms valid input/report
generation only. Planning inputs are capped at 128 KiB, plan files at 128 MiB and observation
files at 16 MiB. Symlinks and sensitive input paths are refused.

Use `createRepositoryAgentBenchmarkPlan(snapshot, reviewedCases, options)` from
`src/forge/repository-analysis/benchmark.ts`. The caller must first read and validate a
current snapshot and verify source freshness through the repository context API. The
planner validates the complete snapshot structure and fingerprint; as a pure function
it cannot establish that files on disk have not changed since analysis.

```ts
const plan = createRepositoryAgentBenchmarkPlan(snapshot, reviewedCases, {
  model: {
    provider: "codex",
    name: "the-explicit-model-selected-for-the-experiment",
    settings: { reasoningEffort: "high" },
  },
  repetitions: 2,
  maxChars: 12000,
});
```

`reviewedCases` uses the same strict contract as `repository quality`: unique case ID,
task query, optional repository-relative scope, expected/forbidden files and test names.
Keep failed retrieval cases in the experiment; removing them after seeing a failure
biases the comparison. Expected files are context relevance expectations, not a requirement
to edit those files and not sufficient acceptance criteria for application behavior.
Use a concrete task query with enough behavior and acceptance detail for independent review.

The JSON-serializable plan contains:

- `binding`: exact source root, snapshot ID, manifest/scenario hashes, and a digest of
  the analyzed input file hashes and metadata.
- `model`: explicit provider, model name and scalar settings. Both arms share all settings.
- `cases`: reviewed context expectations, retained for the evaluator and reviewer.
- `runs`: two isolated runs per case and repetition. Both share prompt, scope, suggested
  check declarations and model settings. `with-maps` additionally receives the bounded
  `repositoryContext` packet. This is the only difference in `workerInput`.
- `planId`, `taskDigest`, `executionDigest`, and `runId`: deterministic content bindings.
  Editing a plan invalidates its identity; foreign or altered observations are rejected.
- `execution: "not-executed"` and `authorization: "external-runner-required"`.

Repetitions are bounded to 1–10 and cases to 1–100. Run order alternates by repetition
to reduce ordering bias. Model settings include no implicit SDK defaults: declare any
settings that can affect output, and require the runner to use them consistently.

## External runner contract

First obtain the normal authorization for model costs, repository changes and actual
application checks. The presence of a check command in a manifest or plan is a suggestion,
not authorization to execute it. The planner never starts a runner.

For each planned run, the external runner should:

1. Prepare a fresh isolated checkout from the exact analyzed source baseline. Keep
   originals unchanged. Verify input hashes, manifest/scenario, dependency state and
   relevant environment before execution. Bind the observation to the original `binding`;
   isolated checkout paths are runner artifacts, not replacement source bindings.
2. Create a fresh worker session. Never reuse sessions between arms, cases or repetitions,
   and prevent shared conversation or generated-artifact leakage between them.
3. Pass **only that run's `workerInput`** to the worker. Do not pass the whole plan or
   hidden expected/forbidden context files to the worker. Withhold other map tools from
   the control arm; provide the same ordinary repository tools and permissions to both.
   Ordinary agents may still read source and discover the same relationships themselves.
4. Record SDK/provider counters for actual input/output/cached input tokens, wall-clock
   latency, and instrumented source-read events. Use evidence references to durable
   traces or logs. Do not infer tokens from character count, reads from filenames in the
   response, or zero latency/read counts from missing telemetry.
5. Preserve the resulting diff/artifact and its SHA-256 digest. Run authorized declared
   application checks in each isolated checkout and record observed outcomes. A map
   query succeeding is not an application check. Missing or skipped checks remain unknown
   or `not-run` and prevent a comparable quality-qualified pair.
6. Have a distinct reviewer inspect the concrete task, actual resulting artifact and
   check evidence. Keep the reviewer blind to the arm and metrics where practical.
   The reviewer must not be any worker in this experiment. Record their verdict against
   that artifact digest; a static retrieval pass cannot substitute for this review.
7. Supply one observation per completed, failed or cancelled run. Keep missing runs
   absent rather than inventing outcomes. Preserve all original evidence artifacts.

The source binding describes the baseline before the worker's edits. Never stamp a
newer snapshot onto an older result. If the source baseline changes, create a new plan.
Identical baseline hashes are necessary but insufficient for environment equivalence;
the runner must record and control dependency versions, network state, tools, limits
and permissions. The evaluator cannot authenticate those conditions.

An observation has this shape (digest placeholders must be replaced by real values):

```json
{
  "planId": "copy-exact-planId",
  "runId": "copy-exact-runId",
  "binding": { "root": "copy-source-root", "snapshotId": "copy-snapshotId", "inputDigest": "copy-inputDigest", "manifestHash": "copy-manifestHash", "scenarioHash": "copy-scenarioHash" },
  "taskDigest": "copy-exact-taskDigest",
  "executionDigest": "copy-exact-executionDigest",
  "model": { "provider": "codex", "name": "the-actual-explicit-model-used", "settings": { "reasoningEffort": "high" } },
  "workerId": "actual-isolated-session-id",
  "status": "completed",
  "artifactDigest": "sha256:<actual-64-hex-digest>",
  "artifactEvidenceRef": "artifact:actual-diff",
  "metrics": {
    "inputTokens": 1200,
    "outputTokens": 400,
    "latencyMs": 5000,
    "sourceReads": [{ "path": "src/example.ts", "chars": 800, "evidenceRef": "trace:actual-read-event" }],
    "evidenceRefs": ["trace:actual-provider-and-runner-counters"],
    "provenance": "executor-observed"
  },
  "checks": [{ "id": "actual-declared-check-id", "status": "passed", "evidenceRef": "check:actual-exit-and-output" }],
  "review": {
    "reviewerId": "actual-independent-review-session-id",
    "artifactDigest": "sha256:<same-actual-artifact-digest>",
    "outcome": "accepted",
    "evidenceRef": "review:actual-review-report"
  }
}
```

All metric fields except `evidenceRefs` and `provenance` are optional. Omit unavailable
counters. The observation's actual reported model/settings must match the declared model,
including settings. A substituted model or reasoning setting invalidates the comparison.
`sourceReads: []` asserts the runner observed zero reads; absence means unknown.
Repeated read events count separately, while `uniqueSourceFiles` deduplicates paths.
Read character totals remain unknown unless every observed event includes a character count.
Token counters are nonnegative safe integers; cached input cannot exceed observed input.
Check statuses are `passed`, `failed`, `not-run`, or `unknown`; executed statuses require
evidence. Review outcomes are `accepted`, `changes-requested`, or `inconclusive`.

## Evaluate and interpret

```ts
const report = evaluateRepositoryAgentBenchmark(plan, observations);
```

The evaluator rejects mutated plans, foreign source roots/snapshots/input digests,
different tasks/execution settings, duplicate runs, undeclared checks, unsupported
fields, invalid counters, artifact review mismatches and reused worker identities.
Reviewers must be independent of all workers. It does not execute or authenticate
anything: the report labels its provenance `external-runner-reported` and preserves
the references supplied with each observation for independent verification.

A pair is comparable only when both arms completed, both actual artifacts received
accepted independent reviews, and all suggested checks declared for that task passed
with evidence. The report keeps other pairs as `pending`, `execution-incomplete`,
`review-required`, or `checks-required`. An empty declared check set does not invent
application coverage: independent task review is still required.

For each comparable pair, differences are **with maps minus without maps**. Negative
token, latency or source-read differences indicate lower observed values for that pair;
they say nothing about quality unless its review and checks qualified it. Aggregate
metrics contain an observed-pair count and mean difference. Missing metrics remain
`null`, including when a quality-qualified pair has no telemetry. Zero is reserved for
an explicitly observed zero or an actual equal-value difference.

Treat the report as a reproducible protocol and evidence ledger. Small fixture samples
do not establish a general benefit, statistical significance, real user acceptance or
production readiness. Report failures, review disagreements, omitted telemetry, environment
limitations and the exact tasks/model/settings alongside any measured improvement.
