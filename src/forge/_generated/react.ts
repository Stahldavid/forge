// @forge-generated generator=0.1.0-alpha.24 input=39a7799ce0d6a71823dac10eaa13053e61eb77cb610a1245f2ea90d381769517 content=7a3f50ffd129a6969d3bea362759c9e28714bb74d46746f402c2e2ab01b9853c
"use client";

import { createForgeReactBindings } from "forge/react";
import { createForgeClient } from "./client.ts";

export type {
  ForgeProviderProps,
  ForgeDevAuthConfig,
  ForgeReactAuth,
  ForgeReactAuthProvider,
  ForgeReactClient,
  ForgeReactError,
  UseCommandOptions,
  UseCommandResult,
  UseLiveQueryOptions,
  UseLiveQueryResult,
  UseQueryOptions,
  UseQueryResult,
} from "forge/react";

const forgeReact = createForgeReactBindings(createForgeClient);

export const ForgeProvider = forgeReact.ForgeProvider;
export const useForgeClient = forgeReact.useForgeClient;
export const useAuth = forgeReact.useAuth;
export const useQuery = forgeReact.useQuery;
export const useCommand = forgeReact.useCommand;
export const useLiveQuery = forgeReact.useLiveQuery;
