// @forge-generated generator=0.1.0-alpha.3 input=d49018f43da5bba5ad177ba70e680f500a3aaba2062aa8f597ee4332662c0305 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
