// @forge-generated generator=0.1.0-alpha.3 input=036146e3c770368a0d71d33e4eff9252acb5ea90669f57bf119dcb1cb4b4e379 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
