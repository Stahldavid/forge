import type { PackageManager } from "../types/runtime.ts";

export interface BuildAddCommandOptions {
  ignoreScripts: boolean;
  workspace?: string;
}

/**
 * Build argv for adding a dependency with lifecycle scripts disabled by default.
 */
export function buildAddCommand(
  pm: PackageManager,
  spec: string,
  options: BuildAddCommandOptions,
): string[] {
  const ignoreScripts = options.ignoreScripts;

  switch (pm) {
    case "bun": {
      const args = ["bun", "add", spec];
      if (ignoreScripts) {
        args.push("--ignore-scripts");
      }
      return args;
    }
    case "npm": {
      const args = ["npm", "install", spec, "--save", "--no-fund", "--no-audit"];
      if (ignoreScripts) {
        args.push("--ignore-scripts");
      }
      if (options.workspace) {
        args.push("--workspace", options.workspace);
      }
      return args;
    }
    case "pnpm": {
      const args = ["pnpm", "add", spec];
      if (ignoreScripts) {
        args.push("--ignore-scripts");
      }
      return args;
    }
    case "yarn": {
      const args = ["yarn", "add", spec];
      if (ignoreScripts) {
        args.push("--ignore-scripts");
      }
      return args;
    }
  }
}
