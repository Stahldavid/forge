import type { IntegrationRecipe } from "../types/integration.ts";
import type { PackageRecipe } from "../types/integration.ts";
import {
  AI_PROVIDER_RECIPES,
  AI_RECIPE,
  POSTHOG_RECIPE,
  REFERENCE_ALIASES,
  SENTRY_RECIPE,
  STRIPE_RECIPE,
  ZOD_RECIPE,
} from "./definitions.ts";

export interface IntegrationRecipeRegistry {
  resolveRecipe(alias: string): IntegrationRecipe | null;
  resolveByPackageName(packageName: string): IntegrationRecipe | null;
  supports(alias: string): boolean;
  list(): IntegrationRecipe[];
}

const REFERENCE_RECIPES: Record<string, IntegrationRecipe> = {
  stripe: STRIPE_RECIPE,
  posthog: POSTHOG_RECIPE,
  sentry: SENTRY_RECIPE,
  zod: ZOD_RECIPE,
  ai: AI_RECIPE,
};

const ALL_RECIPES: IntegrationRecipe[] = [
  STRIPE_RECIPE,
  POSTHOG_RECIPE,
  SENTRY_RECIPE,
  ZOD_RECIPE,
  AI_RECIPE,
  ...AI_PROVIDER_RECIPES,
];

function indexByPackageName(
  recipes: IntegrationRecipe[],
): Map<string, IntegrationRecipe> {
  const map = new Map<string, IntegrationRecipe>();
  for (const recipe of recipes) {
    for (const pkg of recipe.packages) {
      map.set(pkg.packageName, recipe);
    }
  }
  return map;
}

const PACKAGE_INDEX = indexByPackageName(ALL_RECIPES);

export function resolveRecipe(alias: string): IntegrationRecipe | null {
  const normalized = alias.trim().toLowerCase();
  const direct = REFERENCE_RECIPES[normalized];
  if (direct) return direct;

  const provider = AI_PROVIDER_RECIPES.find(
    (r) => r.alias.toLowerCase() === normalized || r.alias === alias,
  );
  if (provider) return provider;

  return null;
}

export function resolveByPackageName(
  packageName: string,
): IntegrationRecipe | null {
  return PACKAGE_INDEX.get(packageName) ?? null;
}

export function supports(alias: string): boolean {
  return resolveRecipe(alias) !== null;
}

export function list(): IntegrationRecipe[] {
  return [...ALL_RECIPES];
}

export function isReferenceAlias(alias: string): boolean {
  return (REFERENCE_ALIASES as readonly string[]).includes(alias.trim().toLowerCase());
}

export function packageRecipeFor(
  recipe: IntegrationRecipe,
  packageName: string,
): PackageRecipe | undefined {
  return recipe.packages.find((p) => p.packageName === packageName);
}

export function createRecipeRegistry(): IntegrationRecipeRegistry {
  return {
    resolveRecipe,
    resolveByPackageName,
    supports,
    list,
  };
}
