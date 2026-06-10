export { CLI_VERSION } from "./version.ts";
export { parseCli, hasUnknownOption, type ParsedCli, type ForgeCommand } from "./parse.ts";
export { runNewCommand, type NewCommandOptions, type NewCommandResult } from "./new.ts";
export { runSelfHostCommand, type SelfHostCommandOptions } from "./self-host.ts";
export { runBuildCommand, type BuildCommandOptions } from "./build.ts";
export { runServeCommand, type ServeCommandOptions } from "./serve.ts";
export { runWorkerCommand, type WorkerCommandOptions } from "./worker.ts";
export {
  executeCommand,
  runGenerateCommand,
  runAddCommand,
  runCheckCommand,
  runInspectCommand,
} from "./commands.ts";
export { main } from "./main.ts";
