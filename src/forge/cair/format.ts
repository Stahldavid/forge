import type {
  CairCommandResult,
  CairObservation,
  CairSnapshot,
} from "./types.ts";

function line(key: string, values: Array<string | number | boolean | null | undefined>): string {
  return [key, ...values.filter((value) => value !== null && value !== undefined).map(String)].join(" ");
}

function formatObservation(observation: CairObservation): string {
  return `${observation.code} ${observation.text}`.trimEnd();
}

export function formatCairSnapshotText(snapshot: CairSnapshot): string {
  const sampleSymbols = snapshot.lexicon.symbols.slice(0, 8).map((symbol) =>
    `${symbol.id}:${symbol.kind}:${symbol.name}@${symbol.moduleId ?? symbol.file}`,
  );
  const samplePackages = snapshot.lexicon.packages.slice(0, 8).map((pkg) =>
    `${pkg.id}:${pkg.name}@${pkg.version}`,
  );
  return [
    `@cair ${snapshot.schemaVersion} snapshot=${snapshot.snapshotId}`,
    line("PROJECT", [`name=${snapshot.project.name}`, `version=${snapshot.project.version}`, `type=${snapshot.project.type}`]),
    line("GRAPH", [
      `modules=${snapshot.summary.modules}`,
      `symbols=${snapshot.summary.symbols}`,
      `edges=${snapshot.summary.edges}`,
      `packages=${snapshot.summary.packages}`,
      `apis=${snapshot.summary.apis}`,
      `tests=${snapshot.summary.tests}`,
      `diagnostics=${snapshot.summary.diagnostics}`,
    ]),
    line("TRUNCATED", [
      `modules=${snapshot.truncated.modules}`,
      `symbols=${snapshot.truncated.symbols}`,
      `packages=${snapshot.truncated.packages}`,
      `apis=${snapshot.truncated.apis}`,
      `tests=${snapshot.truncated.tests}`,
    ]),
    ...snapshot.rules.map((rule) => line("RULE", [rule.id, rule.name])),
    sampleSymbols.length > 0 ? line("SAMPLE_SYMBOLS", sampleSymbols) : "SAMPLE_SYMBOLS none",
    samplePackages.length > 0 ? line("SAMPLE_PACKAGES", samplePackages) : "SAMPLE_PACKAGES none",
    ...snapshot.nextActions.map((action) => line("NEXT", [action])),
    "",
  ].join("\n");
}

export function formatCairObservationsText(observations: CairObservation[]): string {
  return `${observations.map(formatObservation).join("\n")}\n`;
}

export function formatCairHuman(result: CairCommandResult): string {
  if (result.query || result.action) {
    const diagnostics = result.diagnostics.map((diagnostic) =>
      `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    );
    return `${formatCairObservationsText(result.observations)}${diagnostics.length > 0 ? `${diagnostics.join("\n")}\n` : ""}`;
  }
  return formatCairSnapshotText(result.snapshot);
}

export function formatCairJson(result: CairCommandResult): string {
  return `${JSON.stringify({
    schemaVersion: result.snapshot.schemaVersion,
    ok: result.ok,
    subcommand: result.subcommand,
    summary: result.snapshot.summary,
    snapshot: result.subcommand === "snapshot" ? result.snapshot : undefined,
    query: result.query,
    action: result.action,
    observations: result.observations,
    diagnostics: result.diagnostics,
    nextActions: result.nextActions,
    exitCode: result.exitCode,
  }, null, 2)}\n`;
}
