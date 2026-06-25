# ForgeOS for Convex Apps

Convex is an agent-friendly backend. ForgeOS is the app-contract layer around the whole application.

Use the two together when you want Convex to keep backend data, functions, and reactivity simple while ForgeOS makes the full app safer for coding agents to inspect, change, and verify.

## Positioning

```text
Convex makes the backend easy for agents to build.
ForgeOS makes the whole application safe for agents to understand, change, and verify.
```

ForgeOS should not replace Convex in a Convex app. The first useful integration is to make Convex apps more agent-operable:

- classify the `convex` package in the Forge runtime matrix;
- prevent Convex runtime clients from leaking into Forge commands, queries, or liveQueries;
- expose Convex usage as package evidence for agents;
- give agents a future path to import Convex schema/functions into the app contract.

## Install the recipe

```bash
forge add convex
forge deps inspect convex --json
forge inspect runtime-matrix --json
forge check --json
```

The current recipe installs and classifies the `convex` package, registers Convex deployment environment names, emits generated agent docs and a testkit stub, and updates runtime import guards.

## Current alpha support

| Surface | Status |
|---------|--------|
| `forge add convex` recipe | Supported alpha |
| Runtime matrix classification for `convex` | Supported alpha |
| Command/query/liveQuery import guardrails | Supported alpha |
| Generated Convex integration doc/testkit | Supported alpha |
| Import `convex/schema.ts` into the Forge contract | Planned |
| Import `convex/_generated/api.d.ts` into capability map | Planned |
| Route/component to Convex function map | Planned |

## Runtime placement

Allowed:

- client UI code;
- server files;
- actions;
- workflows;
- endpoints;
- tests and builds.

Denied:

- Forge commands;
- Forge queries;
- Forge liveQueries;
- shared runtime modules;
- edge contexts until the package/runtime contract is proven.

Type-only imports are acceptable when TypeScript erases them.

## Future importer

A deeper Convex importer should read:

- `convex/schema.ts` for tables and fields;
- `convex/_generated/api.d.ts` for query, mutation, and action names;
- frontend `useQuery`, `useMutation`, and `useAction` usage;
- route/component ownership;
- auth and deployment notes.

That would let ForgeOS answer:

- which page calls which Convex function;
- which Convex functions appear unused from the UI;
- which UI calls bypass the expected generated client;
- which app changes need Convex dev/typecheck verification.

## Related pages

- [Recipes](recipes.md)
- [Package Intelligence](package-intelligence.md)
- [AI Coding with ForgeOS](ai-coding-with-forgeos.md)
- [Agent Evals](agent-evals.md)
