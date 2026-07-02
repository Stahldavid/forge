// @forge-generated generator=0.1.0-alpha.47 input=bebb010a880143584f74a6be9a4ef8e76d626cc1fd3f32b688b9a669679791c1 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
