// @forge-generated generator=0.1.0-alpha.39 input=f8919744f953e216381deb3344bfadd99210164d5b86a1ecfa27c2e44825c874 content=4cfce78d6b321a78dbfbf28116e9af89864631bbd1324ff58acdb261a4477f08
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
