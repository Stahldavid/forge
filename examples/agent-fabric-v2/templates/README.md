# Owner-bound authoring templates

These JSON requests select the review, bugfix and migration templates. `program-author`
validates references against the owner's registry and returns a proposal without running
workers, replacing policies, applying changes or spending model tokens. Start is a
separate action. The supplied registry's workers and migration criteria are text-file
fixtures; replace them with real project contracts and verification commands for coding.

Review begins with assessment and requests an empty write scope. A negative assessment
cannot change files; bounded follow-up may end exhausted or stalled. Bugfix assesses
first, avoiding edits to an already accepted baseline. Migration consumes
`input.items: [{id, allowedPaths}]`, seals coverage against the owner population, repairs
each item only after a negative assessment, composes accepted candidates and assesses the integrated candidate before gate. An optional owner-authorized resolver can be selected in migration options; its candidate requires fresh final population evaluation.

Each repair preserves mandatory checks. Scoped acceptance must bind `component` to
`item` and `assessment` to `final`; templates do not mutate these owner bindings.
Human approval, when required, remains outstanding at the gate. Apply remains separate.
`program-author-types` exports owner schema/executor declarations for author assistance;
runtime validation is still authoritative.

## Independent benchmark reports

`program-benchmark.ts` defines a versioned observation report. Record identity of runtime,
model, tools, context, contracts and budget for each task. Queue/preparation/execution/
capture/persistence/integration timings are optional observations; omitted means absent,
not zero. Consumption is observed, estimated or unknown. Independent evaluation requires
an assessor and criteria digest fixed independently of the implementer. Owner gate
approval alone does not qualify as external success.

Read and summarize an already collected report with:

```sh
node --import tsx scripts/summarize-fabric-benchmark.mjs report.json
```

This command only validates data. It does not run workflows, providers or benchmarks.
The existing deterministic benchmark scripts remain runtime references and do not prove
superiority over Claude or coding quality. Real evaluations are a separate explicit run.

## CI scope

PRs changing only explicitly covered authoring, observation, benchmark or adapter modules use a small critical suite. Missing critical files fail closed.
Core owner/store/workspace/services, shared or unknown paths and main runs retain the full Agent Fabric suite. Workflow
contracts, typecheck, compiler checks, lint and the separate security gate remain.
Ubuntu/Node 22 CLI smoke runs once in verify; the matrix adds Windows 22 for PRs and
Ubuntu 24 on main. Manual CI includes macOS.
