// @forge-generated generator=0.0.0 input=8f74d80244f472bdbd28e32d310c3754a3301ecc0276cb8fb06d23335cf21d46 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
