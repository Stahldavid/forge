// @forge-generated generator=0.1.0-alpha.9 input=ca868c8ec6ee8cac0b8a654cbdfef0cc44cdb8d68fa7e924cc6237ac0241a710 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
