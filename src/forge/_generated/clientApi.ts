// @forge-generated generator=0.1.0-alpha.15 input=67cf6717e9ba5e94f88e7a31f4ec4bd11bca063e91c093d1365c00db340f2c1e content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
