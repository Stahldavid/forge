import type { SecretRequirement } from "../../types/capability.ts";
import type { AppGraph } from "../../types/app-graph.ts";
import type { IntegrationRecipe } from "../../types/integration.ts";
import type { RuntimeContext } from "../../types/runtime.ts";

export interface IntegrationTemplateInput {
  alias: string;
  recipe: IntegrationRecipe;
  context: RuntimeContext;
  packageName: string;
  packageNames: string[];
  secrets: SecretRequirement[];
  compatible: RuntimeContext[];
  incompatible: RuntimeContext[];
  workspaceRoot?: string;
  appGraph?: AppGraph;
}
