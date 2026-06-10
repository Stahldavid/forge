// @forge-generated generator=0.0.0 input=b9d7d019aa8c2811f2953e43225272739b98916ff1bcd7639ef748a725373354 content=432498839579d179427aaff0644195e66e29eb4aa96a9da26145834740208e17
"use client";

import { createForgeReactBindings } from "forge/react";
import { createForgeClient } from "./client.ts";

export type {
  ForgeProviderProps,
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
