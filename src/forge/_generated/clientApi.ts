// @forge-generated generator=0.1.0-alpha.9 input=8272d9166eb01c344388e0da68a01dbb2259b236af7b9fe5c7605e4a01ce57fc content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
