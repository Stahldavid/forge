// @forge-generated generator=0.1.0-alpha.14 input=a43a0684c37e2ef6e7bce4adf441dbc821a8de9a5fa05aca373a8dd420940b7d content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
