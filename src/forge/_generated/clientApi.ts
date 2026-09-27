// @forge-generated generator=0.1.0-alpha.63 input=62246762620888d4eb3bd4233fe8c61c4adcead4d706dd12016618e6604e0aeb content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
