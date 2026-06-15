// @forge-generated generator=0.1.0-alpha.0 input=bbcb5249a5456591d9d88ee11d0e1be99fc6bd72fc1bd3e65550c8656da372cf content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
