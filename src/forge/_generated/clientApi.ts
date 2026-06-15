// @forge-generated generator=0.1.0-alpha.2 input=53ebe776c36da97cc5e1cdd3412de67fa665c6640a49fb8f7c76c8a09ab92af6 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
