import type { ForgeGuardArtifacts } from "./load-artifacts.ts";
import { loadForgeGuardArtifacts } from "./load-artifacts.ts";
import {
  checkSourceForgeGuards,
  type ForgeGuardSourceViolation,
} from "./check-source.ts";

export interface ForgeEslintSettings {
  importGuardsPath?: string;
  runtimeMatrixPath?: string;
}

export interface ForgeEslintContext {
  filename: string;
  sourceCode: string;
  settings?: { forge?: ForgeEslintSettings };
  report: (descriptor: {
    message: string;
    line: number;
    column: number;
    endColumn: number;
  }) => void;
}

let cachedArtifacts: ForgeGuardArtifacts | null = null;
let cachedKey = "";

function resolveArtifacts(context: ForgeEslintContext): ForgeGuardArtifacts | null {
  const forgeSettings = context.settings?.forge;
  const importGuardsPath = forgeSettings?.importGuardsPath;
  const runtimeMatrixPath = forgeSettings?.runtimeMatrixPath;

  if (!importGuardsPath || !runtimeMatrixPath) {
    return null;
  }

  const key = `${importGuardsPath}|${runtimeMatrixPath}`;
  if (cachedArtifacts && cachedKey === key) {
    return cachedArtifacts;
  }

  cachedArtifacts = loadForgeGuardArtifacts(importGuardsPath, runtimeMatrixPath);
  cachedKey = key;
  return cachedArtifacts;
}

export function runForgeGuardRule(context: ForgeEslintContext): void {
  const artifacts = resolveArtifacts(context);
  if (!artifacts) {
    return;
  }

  const violations = checkSourceForgeGuards(
    context.filename,
    context.sourceCode,
    artifacts.importGuards,
    artifacts.runtimeMatrix,
  );

  for (const violation of violations) {
    context.report({
      message: `'${violation.packageName}' is not allowed in '${violation.context}' context: ${violation.rationale}`,
      line: violation.line,
      column: violation.column,
      endColumn: violation.endColumn,
    });
  }
}

export function formatViolationMessage(violation: ForgeGuardSourceViolation): string {
  return `'${violation.packageName}' is not allowed in '${violation.context}' context: ${violation.rationale}`;
}

export const forgeGuardRuleDefinition = {
  meta: {
    type: "problem" as const,
    docs: {
      description:
        "Disallow package imports incompatible with Forge effective runtime contexts",
    },
    schema: [],
    messages: {
      violation: "{{message}}",
    },
  },
  create(context: ForgeEslintContext) {
    return {
      Program() {
        runForgeGuardRule(context);
      },
    };
  },
};
