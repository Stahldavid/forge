import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { FORGE_LOCK_PATH, GENERATED_DIR } from "../emitter/constants.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { ForgeLock } from "../types/lock.ts";

export const WORKOS_FGA_INTEGRATION_FILES = new Set([
  "workos/fga.ts",
  "workos/resource-map.ts",
]);

function filterWorkOSFga(recipe: IntegrationRecipe): IntegrationRecipe {
  return {
    ...recipe,
    integrations: recipe.integrations?.filter((file) => !WORKOS_FGA_INTEGRATION_FILES.has(file)),
  };
}

export function applyWorkOSRecipeProfile(
  recipe: IntegrationRecipe,
  options: { withFga?: boolean },
): IntegrationRecipe {
  if (recipe.alias !== "workos" || options.withFga) {
    return recipe;
  }
  return filterWorkOSFga(recipe);
}

function readForgeLock(workspaceRoot: string): ForgeLock | null {
  const absolute = join(workspaceRoot, FORGE_LOCK_PATH);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(absolute) ?? "") as ForgeLock;
  } catch {
    return null;
  }
}

function lockEnablesWorkOSFga(lock: ForgeLock | null): boolean {
  const entry = lock?.packages.find((pkg) => pkg.name === "@workos-inc/node" || pkg.name === "workos");
  return Boolean(entry?.generatedFiles.some((file) =>
    file === `${GENERATED_DIR}/integrations/workos/fga.ts` ||
    file === `${GENERATED_DIR}/integrations/workos/resource-map.ts`
  ));
}

function seedEnablesWorkOSFga(workspaceRoot: string): boolean {
  for (const path of [
    "workos-seed.yml",
    `${GENERATED_DIR}/integrations/workos/workos-seed.yml`,
  ]) {
    const text = nodeFileSystem.readText(join(workspaceRoot, path));
    if (text !== null && /^\s*resource_types\s*:/m.test(text)) {
      return true;
    }
  }
  return false;
}

function workspaceEnablesWorkOSFga(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, ".workos-fga-state.json")) ||
    seedEnablesWorkOSFga(workspaceRoot) ||
    lockEnablesWorkOSFga(readForgeLock(workspaceRoot));
}

export function applyWorkspaceRecipeProfile(
  recipe: IntegrationRecipe | null | undefined,
  workspaceRoot: string,
): IntegrationRecipe | undefined {
  if (!recipe) {
    return undefined;
  }
  if (recipe.alias !== "workos") {
    return recipe;
  }
  return applyWorkOSRecipeProfile(recipe, {
    withFga: workspaceEnablesWorkOSFga(workspaceRoot),
  });
}
