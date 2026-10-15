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

## Current workflow runtime and UI example

`ui-audit.workflow.ts` uses the current operatorVersion 2 architecture directly. `run-ui-fixture.ts` is a disposable local integration example: twenty HTML pages, three known defects, command-only agents, item and final checks, capture receipts, compose and gate. Run `node bin/forge-bun.mjs run examples/agent-fabric-v2/run-ui-fixture.ts` from the Forge checkout. It sets the no-LLM fuse and never applies to a user project.

`runUiFixture(count, defects, browserPath?)` also accepts an explicit Chromium/Edge executable for real local headless screenshots; the default uses valid PNG fixtures. Both reviewers are deterministic checks of fixture attributes, not visual AI evaluation. The worker's cooperative process capability must be owner-authorized.

The static lowerer and TS author API share the same example including `as const`, `satisfies`, typed refs and scoped checks. Arbitrary TS execution is unsupported. Legacy file-conversion example remains a separate usage example, not a compatibility interpreter. See docs/agent-fabric-programs.md for all fifty author constructors and fifteen controls.

## Typed reusable subworkflow and visual cases

`item-child.workflow.ts` is a finite typed inspection program. Lower it and register its IR as `inspect-item@v2`; the root `map-child.workflow.ts` calls it with explicit input and a map quota of one. Supply owner schemas `path@v2` (object path:string), `inspection@v2` (object ok:boolean), `any@v2`, policy `local@v2`, acceptance `data@v2`, and executor `inspect@v2` with inputSchema path@v2/output schema inspection@v2. These are templates, not automatically installed executors. Child quotas/cancellation inherit from the root; keep the same policy/acceptance.

`visual-population.json` demonstrates separate desktop/ready and mobile/error cases for one route. Replace the baseline placeholder with the owner-captured digest and enumerate all required scenarios. Matching itemKey alone cannot close a visual case when route, viewport, state or dimensions differ. Image header validation is not proof of visual correctness.

Use program-explain to retrieve the template graph, observed expansions and a Mermaid diagram. Format 3 runs live in program-runs-v3; older checkpoint directories are preserved and not loaded.
