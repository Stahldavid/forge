# Agent Fabric program workflows v2

This is an opt-in local text-file conversion example. It uses four registered command
executors and deterministic file checks. It does not prove model quality or code-review
acceptance. For a coding workflow, register a distinct readonly Codex reviewer and the
actual project verification commands instead of these demonstration workers.

Use a disposable Git project containing this directory's files and `src/a.txt` and
`src/b.txt` with contents `old`. Commit the baseline. Create `.forge/` and copy
`registry.example.json` to `.forge/fabric-programs.json`. Review the explicit `argv`,
write scopes, network permission and timeout first. Commands run in isolated clones
but their OS permissions are cooperative. They inherit host networking; this example
does not require a network request. SDK executors require disabled network and sandbox.

Run `forge fabric serve` in that project and keep the owner alive. In a second terminal:

```sh
node make-request.mjs migrate.workflow.ts start.json
forge fabric program-validate --file start.json --json
forge fabric program-start --file start.json --json
forge fabric program-status --run-id RUN_ID --json
```

The lowerer reads the TypeScript as finite data; it never imports or executes it.
The owner inventories `.txt` files in the captured baseline. Discovery must match that
population. Each item's recipe implements, reviews and checks its immutable candidate.
Composition includes every accepted item's deltas. Integration starts with assessment
before deciding whether another correction is needed.

`acceptance-ready` includes an owner gate and `acceptedCandidate`. The original files
are still `old`. To apply the accepted candidate, create an `apply.json` request using
the latest version from status:

```json
{
  "runId": "RUN_ID",
  "requestId": "unique-apply-request",
  "expectedVersion": 123,
  "authorization": "Owner authorizes local conversion of the scoped src files"
}
```

```sh
forge fabric program-apply --file apply.json --json
```

That action changes local files after a frozen ApplyIntent and beforeimage checks.
It does not commit, push or deploy. After interrupted publication, inspect the state
and actual files before `program-reconcile`; never automatically retry uncertainty.

The owner registry is project configuration, not workflow input. `cache: none` is the
default. Only commands declared to depend entirely on their captured workspace inputs
may opt into `cache: workspace`; the owner must account for external inputs. SDK output
reuse is disabled until its effective instruction closure can be attested.
