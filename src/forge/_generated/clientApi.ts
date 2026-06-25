// @forge-generated generator=0.1.0-alpha.27 input=c421aa52eea72a123ad08deaf57d3e0438100460fc40d12edf5d5fe2fff0e58f content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
