// @forge-generated generator=0.1.0-alpha.63 input=cefae73a286f2c10ee10ee59b0d06dd93a157cd7085a48f2f9e097d8c03c61a3 content=4cfce78d6b321a78dbfbf28116e9af89864631bbd1324ff58acdb261a4477f08
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
