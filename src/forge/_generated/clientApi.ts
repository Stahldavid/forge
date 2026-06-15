// @forge-generated generator=0.1.0-alpha.0 input=663bd72fd297303ae67eb0c0c2217d62f2812ed9bd19c3b7f91de866277d7c97 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
