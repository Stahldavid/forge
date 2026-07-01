const configuredForgeUrl = import.meta.env.VITE_FORGE_URL as string | undefined;
const useSameOrigin =
  typeof window !== "undefined" &&
  (!configuredForgeUrl ||
    configuredForgeUrl.includes("127.0.0.1") ||
    configuredForgeUrl.includes("localhost"));

export const forgeUrl = useSameOrigin ? "" : (configuredForgeUrl ?? "");

export { api } from "../../../src/forge/_generated/api";
export { createForgeClient, ForgeError } from "../../../src/forge/_generated/client";
export {
  ForgeProvider,
  useAuth,
  useCommand,
  useCommandResult,
  useForgeClient,
  useLiveQuery,
  useQuery,
} from "../../../src/forge/_generated/react";
