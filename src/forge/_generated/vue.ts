// @forge-generated generator=0.1.0-alpha.69 input=1a757f8138dce62d02cf737305afc180007713aea8c06300609609a8e9aa669b content=7c33d583c6f4e735c4f18c6bd8cc68342f8b7ca1053ac068db5f836c5c56c1fa
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
