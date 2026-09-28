// @forge-generated generator=0.1.0-alpha.66 input=57341432921f2c43eddb033a05cc7ad25dabd9813fcf2fd64c67f74ae5f61859 content=f76d5aedd5c0f5bd80995094379b6dce0fbf0f8873c038119ca2251a44e4113d
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
  external: api.external,
} as const;
