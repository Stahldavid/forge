// @forge-generated generator=0.1.0-alpha.2 input=f450ec7161e279f2460d497d4129943c5786d075c3be87365a6f1f0ab77a3fcd content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
