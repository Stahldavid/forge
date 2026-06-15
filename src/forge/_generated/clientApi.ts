// @forge-generated generator=0.1.0-alpha.1 input=15db5211b2295feba64a25a14ce8d07c783b9685e9994859941a0139d6f10d5d content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
