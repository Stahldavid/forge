// @forge-generated generator=0.1.0-alpha.72 input=a9884755157b13634a2b69e255d6418f0092af011d647161d0cfff332ffbbe63 content=8f8204bfae9b75050ec2f56655911b938e1af029a25e3028d6c8467b64ddd9e7
# CAIR Agent Guide

Project: forgeos
CAIR version: 0.5.0
Surface: commands=0 queries=0 liveQueries=0 actions=1 workflows=0 tables=0

CAIR is the compact agent protocol for reading and changing this Forge workspace. Use it when symbol, module, dependency, test or impact context helps the task; direct targeted reads are appropriate for known files and exact text questions. Read-only questions do not require creating or refreshing a snapshot.

## First commands

```bash
node bin/forge.mjs cair snapshot
node bin/forge.mjs cair query "Q ST"
```

The snapshot emits compact ids:

- `M#` modules/files
- `S#` symbols
- `P#` packages
- `API#` dependency APIs
- `T#` tests

## Read before editing

```bash
node bin/forge.mjs cair query "Q S name=<symbol>"
node bin/forge.mjs cair query "Q D S#1"
node bin/forge.mjs cair query "Q R S#1"
node bin/forge.mjs cair query "Q I S#1"
node bin/forge.mjs cair query "Q T S#1"
node bin/forge.mjs cair query "Q DEP.API package=<pkg> symbol=<export>"
```

Read the relevant source when needed to verify the result. CAIR results help focus that read; they do not replace source evidence or prove exhaustive coverage.

## Plan, apply, rollback

Never apply semantic mutations first. Create a plan:

```bash
node bin/forge.mjs cair action --plan "A RN t=S#1 nn=<newName>"
```

Apply the returned plan path:

```bash
node bin/forge.mjs cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
```

Keep returned journal paths for rollback:

```bash
node bin/forge.mjs cair action "A ROLLBACK journal=.forge/cair/journal/<journal>.json"
```

## Semantic actions

```txt
A RN t=S#1 nn=<newName>
A MV t=S#1 to=src/target.ts
A SIG t=S#1 signature="export function x(input: string): boolean"
A PARAM t=S#1 name=tenantId type=string default="defaultTenant"
A CALLS t=S#1 appendArg="defaultTenant"
A OI f=M#1
A FMT f=M#1
```

For high-risk semantic actions, include expectations when available:

```txt
expect.file=src/path.ts
expect.kind=command
expect.hash=<sha256>
```

## Forge-native actions

Prefer Forge-native CAIR actions over hand-writing boilerplate:

```txt
A MC n=createTicket
A MQ n=listTickets
A MA n=chargeCustomer
A MT n=tickets fields=title:text,status:text
A AT t=S#1 kind=unit
A WX t=S#1 file=src/index.ts
```

## Compact aliases

Queries:

```txt
Q ST  = Q STATUS
Q S   = Q SYMBOL
Q D   = Q DEF
Q R   = Q REFS
Q I   = Q IMPACT
Q M   = Q MODULE
Q T   = Q TESTS
Q API = Q DEP.API
```

Actions:

```txt
A RN  = A RENAME.SYMBOL
A MV  = A MOVE.SYMBOL
A OI  = A ORGANIZE.IMPORTS
A FMT = A FORMAT
A MC  = A MAKE.COMMAND
A MQ  = A MAKE.QUERY
A MA  = A MAKE.ACTION
A MT  = A MAKE.TABLE
A AT  = A ADD.TEST
A WX  = A WIRE.EXPORT
A AP  = A APPLY
A RB  = A ROLLBACK
```

## Verification

After a semantic CAIR edit, run `node bin/forge.mjs check --json` and the affected tests or `node bin/forge.mjs verify --changed`. Read-only CAIR queries require no application tests. Use `node bin/forge.mjs verify --standard` when broader affected behavior warrants it; use `node bin/forge.mjs verify framework` for a migration, changed auth/security boundary or explicitly comprehensive delivery. Do not repeat passing checks without new changes or unresolved concerns.

## Constraints

- Do not edit `src/forge/_generated/**` unless explicitly allowed.
- Do not bypass `--plan` for semantic edits.
- Do not use CAIR as blind text replacement when a semantic action exists.
- Use compiler-aware tools when symbol resolution or complete references matter, and direct reads for known files. Preserve CAIR plan/apply guards whenever choosing its semantic mutation protocol.
