// @forge-generated generator=0.1.0-alpha.9 input=f8247c48f65f765e34269321a93a803b5c3f6b43c92841fd1bc009e13eee2a31 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
