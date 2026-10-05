// @forge-generated generator=0.1.0-alpha.67 input=cad72fb61cedf1a3702763e37d3d5706a149a8719284ec9090a960aa3a4e1e61 content=4cfce78d6b321a78dbfbf28116e9af89864631bbd1324ff58acdb261a4477f08
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
  ForgeCommandCallResult,
  UseCommandOptions,
  UseCommandResult,
  UseCommandResultHook,
  UseCommandResultOptions,
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
export const useCommandResult = forgeReact.useCommandResult;
export const useLiveQuery = forgeReact.useLiveQuery;
