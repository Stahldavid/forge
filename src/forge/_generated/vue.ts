// @forge-generated generator=0.1.0-alpha.26 input=778efcf6ab1654d740a63150785427347e3b87d5b7720acc9f26a9e512e0e5fa content=7c33d583c6f4e735c4f18c6bd8cc68342f8b7ca1053ac068db5f836c5c56c1fa
import { createForgeVueBindings } from "forge/vue";
import { createForgeClient } from "./client.ts";

export type {
  ForgeDevAuthConfig,
  ForgeVueAuth,
  ForgeVueAuthProvider,
  ForgeVueBindings,
  ForgeVueClient,
  ForgeVueClientConfig,
  ForgeVueError,
  ForgeVuePluginOptions,
  UseForgeCommandOptions,
  UseForgeCommandResult,
  UseForgeLiveQueryOptions,
  UseForgeLiveQueryResult,
  UseForgeQueryOptions,
  UseForgeQueryResult,
} from "forge/vue";

const forgeVue = createForgeVueBindings(createForgeClient);

export const ForgeVuePlugin = forgeVue.ForgeVuePlugin;
export const provideForge = forgeVue.provideForge;
export const useForgeClient = forgeVue.useForgeClient;
export const useForgeAuth = forgeVue.useForgeAuth;
export const useForgeQuery = forgeVue.useForgeQuery;
export const useForgeCommand = forgeVue.useForgeCommand;
export const useForgeLiveQuery = forgeVue.useForgeLiveQuery;
