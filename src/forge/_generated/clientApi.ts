// @forge-generated generator=0.1.0-alpha.0 input=91d8894f322b8dd604714d7b26a8bac3b5bbb0904d62cc0e2761ba21098e1537 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
