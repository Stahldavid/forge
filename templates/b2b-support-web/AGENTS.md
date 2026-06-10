# AGENTS.md

This is a ForgeOS app.

Before editing:
- run `forge inspect app --json`
- run `forge inspect data --json`
- run `forge inspect runtime-matrix --json`

After editing:
- run `forge generate`
- run `forge check`
- run `forge verify --strict`

Do not:
- import network packages in command/query/liveQuery
- use process.env directly
- bypass ctx.secrets
- write cross-tenant queries
- edit src/forge/_generated manually
