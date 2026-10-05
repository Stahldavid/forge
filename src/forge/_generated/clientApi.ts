// @forge-generated generator=0.1.0-alpha.68 input=eb85ce79777e8854119a312edd29262099578bdd5f8be82c03b5f0caae80f391 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
