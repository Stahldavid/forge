// @forge-generated generator=0.1.0-alpha.0 input=01d6a3848650ea2a03ea8e037b400dc6497d1527c05345535ef5080132d7aabb content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
