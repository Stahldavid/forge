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
