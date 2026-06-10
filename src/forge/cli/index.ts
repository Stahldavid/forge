export { CLI_VERSION } from "./version.ts";
export { parseCli, hasUnknownOption, type ParsedCli, type ForgeCommand } from "./parse.ts";
export { runNewCommand, type NewCommandOptions, type NewCommandResult } from "./new.ts";
export {
  executeCommand,
  runGenerateCommand,
  runAddCommand,
  runCheckCommand,
  runInspectCommand,
} from "./commands.ts";
export { main } from "./main.ts";
