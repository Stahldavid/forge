// @forge-generated generator=0.1.0-alpha.19 input=bc0acfe814a5985cc4e818ea3aabd00bf4df870c2a7f98542671de2228b16a16 content=0a26d1c5851c6223a7730cef1e94266b03560225d393d19355fd70e12bd90c84
# CAIR Agent Guide

Project: forgeos
CAIR version: 0.5.0
Surface: commands=0 queries=0 liveQueries=0 actions=0 workflows=0 tables=0

CAIR is the compact agent protocol for reading and changing this Forge workspace. Use it before opening whole files when symbol, module, dependency, test, or impact context is enough.

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

Only open source files after CAIR shows that the exact file or body is needed.

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

After CAIR edits, run the narrowest useful checks:

```bash
node bin/forge.mjs check --json
node bin/forge.mjs verify --standard
node bin/forge.mjs verify framework
```

## Constraints

- Do not edit `src/forge/_generated/**` unless explicitly allowed.
- Do not bypass `--plan` for semantic edits.
- Do not use CAIR as blind text replacement when a semantic action exists.
- Use TypeScript language service, ast-grep, ts-morph, or raw file reads only as implementation backends or fallbacks. CAIR is the agent-facing protocol.
