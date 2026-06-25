// @forge-generated generator=0.1.0-alpha.26 input=778efcf6ab1654d740a63150785427347e3b87d5b7720acc9f26a9e512e0e5fa content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
