// @forge-generated generator=0.1.0-alpha.18 input=d037a38973574e99c5c6fe2374b25cddbe8b19b9f673974d1f9f4858c3f8b03b content=7c33d583c6f4e735c4f18c6bd8cc68342f8b7ca1053ac068db5f836c5c56c1fa
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
