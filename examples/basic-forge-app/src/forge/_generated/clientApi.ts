// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=d331e860feeb8e9f3bcdcf45c3ff0ab2ebcd41bb96fbf204bb83dc7fcfda1ab3
import { api } from "./api.ts";

/** Client-side typed API surface (queries, commands; no server adapters). */
export const clientApi = {
  queries: api.queries,
  commands: api.commands,
  liveQueries: api.liveQueries,
} as const;
