// @forge-generated generator=0.1.0-alpha.63 input=3ba530f8432c93912c3e9b02ed9be6c6365dad9216f0a63d0c0a517cb06d4665 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
