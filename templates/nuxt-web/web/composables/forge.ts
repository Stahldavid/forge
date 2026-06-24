export const forgeUrl = "http://127.0.0.1:3765";

export { api } from "../../src/forge/_generated/api";
export { createForgeClient, ForgeError } from "../../src/forge/_generated/client";
export {
  ForgeVuePlugin,
  provideForge,
  useForgeAuth,
  useForgeClient,
  useForgeCommand,
  useForgeLiveQuery,
  useForgeQuery,
} from "../../src/forge/_generated/vue";
