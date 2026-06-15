export const forgeUrl =
  process.env.NEXT_PUBLIC_FORGE_URL ?? "http://127.0.0.1:3765";

export { api } from "../../src/forge/_generated/api";
export { createForgeClient, ForgeError } from "../../src/forge/_generated/client";
export {
  ForgeProvider,
  useAuth,
  useCommand,
  useForgeClient,
  useLiveQuery,
  useQuery,
} from "../../src/forge/_generated/react";
export type { ForgeReactError } from "../../src/forge/_generated/react";
