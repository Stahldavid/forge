import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { buildWorkspaceGitSummary } from "../workspace/git-summary.ts";
import type {
  CairChangedObservation,
  CairObservation,
  CairQueryResult,
  CairSnapshot,
  CairSymbolRef,
  CairTestRef,
} from "./types.ts";

function tokens(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

function keyValues(parts: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    values.set(part.slice(0, index).toLowerCase(), part.slice(index + 1));
  }
  return values;
}

function error(query: string, message: string): CairQueryResult {
  const diagnostic = createDiagnostic({
    severity: "error",
    code: "FORGE_CAIR_QUERY",
    message,
  });
  return { ok: false, query, observations: [], diagnostics: [diagnostic] };
}

function observation(code: string, text: string, data?: Record<string, unknown>): CairObservation {
  return data ? { code, text, data } : { code, text };
}

function statusObservations(snapshot: CairSnapshot): CairObservation[] {
  return [
    observation(
      "O STATUS",
      [
        `project=${snapshot.project.name}`,
        `modules=${snapshot.summary.modules}`,
        `symbols=${snapshot.summary.symbols}`,
        `edges=${snapshot.summary.edges}`,
        `packages=${snapshot.summary.packages}`,
        `apis=${snapshot.summary.apis}`,
        `tests=${snapshot.summary.tests}`,
        `diagnostics=${snapshot.summary.diagnostics}`,
      ].join(" "),
      {
        project: snapshot.project,
        summary: snapshot.summary,
        truncated: snapshot.truncated,
      },
    ),
    ...snapshot.rules.map((rule) =>
      observation("O RULE", `${rule.id} ${rule.name}`, {
        id: rule.id,
        name: rule.name,
        description: rule.description,
      }),
    ),
  ];
}

function changedObservation(workspaceRoot: string): CairObservation {
  const git = buildWorkspaceGitSummary(workspaceRoot);
  const data: CairChangedObservation = {
    available: git.available,
    ...(git.branch ? { branch: git.branch } : {}),
    ...(git.commit ? { commit: git.commit } : {}),
    changed: git.changeSummary.changed,
    staged: git.changeSummary.staged,
    unstaged: git.changeSummary.unstaged,
    untracked: git.changeSummary.untracked,
    ...(git.error ? { error: git.error } : {}),
  };
  return observation(
    "O CHANGED",
    [
      `available=${git.available}`,
      git.branch ? `branch=${git.branch}` : null,
      git.commit ? `commit=${git.commit}` : null,
      `changed=${git.changeSummary.changed.total.count}`,
      `staged=${git.changeSummary.staged.total.count}`,
      `unstaged=${git.changeSummary.unstaged.total.count}`,
      `untracked=${git.changeSummary.untracked.total.count}`,
      `types=${git.changeSummary.changed.primaryTypes.join(",") || "none"}`,
    ].filter(Boolean).join(" "),
    data as unknown as Record<string, unknown>,
  );
}

function findSymbol(snapshot: CairSnapshot, arg: string | undefined, kv: Map<string, string>): CairSymbolRef | null {
  if (arg?.startsWith("S#")) {
    return snapshot.lexicon.symbols.find((symbol) => symbol.id === arg) ?? null;
  }
  const name = kv.get("name") ?? arg;
  if (!name) {
    return null;
  }
  return snapshot.lexicon.symbols.find((symbol) =>
    symbol.name === name || symbol.qualifiedName === name || symbol.sourceId === name,
  ) ?? null;
}

function symbolObservation(symbol: CairSymbolRef): CairObservation {
  return observation(
    "O SYMBOL",
    [
      symbol.id,
      `kind=${symbol.kind}`,
      `name=${symbol.name}`,
      `file=${symbol.file}`,
      `span=${symbol.span.start}:${symbol.span.end}`,
      symbol.moduleId ? `module=${symbol.moduleId}` : null,
    ].filter(Boolean).join(" "),
    {
      symbol,
      nextActions: [
        `forge cair query "Q TESTS ${symbol.id}"`,
        `forge cair query "Q MODULE ${symbol.moduleId ?? symbol.file}"`,
      ],
    },
  );
}

function definitionObservation(snapshot: CairSnapshot, workspaceRoot: string, arg: string | undefined, kv: Map<string, string>): CairObservation {
  const symbol = findSymbol(snapshot, arg, kv);
  if (!symbol) {
    return observation("O DEF", "matches=0 reason=symbol_not_found");
  }
  const absolute = join(workspaceRoot, symbol.file);
  const source = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const declaration = source
    ? source.slice(symbol.span.start, symbol.span.end).trim()
    : "";
  return observation(
    "O DEF",
    [
      `symbol=${symbol.id}`,
      `file=${symbol.file}`,
      `span=${symbol.span.start}:${symbol.span.end}`,
      `hash=${symbol.hash}`,
    ].join(" "),
    {
      symbol,
      declaration,
      nextActions: [
        `forge cair query "Q REFS ${symbol.id}"`,
        `forge cair query "Q IMPACT ${symbol.id}"`,
      ],
    },
  );
}

function refsObservation(snapshot: CairSnapshot, workspaceRoot: string, arg: string | undefined, kv: Map<string, string>): CairObservation {
  const symbol = findSymbol(snapshot, arg, kv);
  if (!symbol) {
    return observation("O REFS", "matches=0 reason=symbol_not_found", { refs: [] });
  }
  const regex = new RegExp(`\\b${symbol.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const refs: Array<{ file: string; start: number; end: number; definition: boolean }> = [];
  for (const module of snapshot.lexicon.modules) {
    const absolute = join(workspaceRoot, module.file);
    if (!existsSync(absolute)) {
      continue;
    }
    const text = readFileSync(absolute, "utf8");
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      refs.push({
        file: module.file,
        start: match.index,
        end: match.index + match[0].length,
        definition: module.file === symbol.file && match.index >= symbol.span.start && match.index <= symbol.span.end,
      });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
  return observation(
    "O REFS",
    `symbol=${symbol.id} matches=${refs.length} files=${new Set(refs.map((ref) => ref.file)).size}`,
    { symbol, refs: refs.slice(0, 200), truncated: Math.max(0, refs.length - 200) },
  );
}

function findModuleObservation(snapshot: CairSnapshot, arg: string | undefined): CairObservation | null {
  if (!arg) {
    return null;
  }
  const module = snapshot.lexicon.modules.find((candidate) =>
    candidate.id === arg || candidate.file === arg || candidate.file.endsWith(arg),
  );
  if (!module) {
    return null;
  }
  return observation(
    "O MODULE",
    [
      module.id,
      `file=${module.file}`,
      `packages=${module.packageImports.join(",") || "none"}`,
      `localImports=${module.localImportCount}`,
      `contexts=${module.contexts.join(",") || "none"}`,
    ].join(" "),
    { module },
  );
}

function coverageBucket(symbol: CairSymbolRef): keyof CairTestRef["covers"] | null {
  switch (symbol.kind) {
    case "command":
      return "commands";
    case "query":
      return "queries";
    case "liveQuery":
      return "liveQueries";
    case "action":
      return "actions";
    case "workflow":
      return "workflows";
    case "schema.table":
      return "tables";
    case "policy":
      return "policies";
    default:
      return null;
  }
}

function testsForSymbol(snapshot: CairSnapshot, symbol: CairSymbolRef): CairTestRef[] {
  const bucket = coverageBucket(symbol);
  if (!bucket) {
    return [];
  }
  return snapshot.lexicon.tests.filter((test) => {
    const covered = test.covers[bucket];
    return covered.includes(symbol.name) || covered.includes(symbol.qualifiedName) || covered.includes(symbol.sourceId);
  });
}

function testsObservation(snapshot: CairSnapshot, arg: string | undefined, kv: Map<string, string>): CairObservation {
  const symbol = findSymbol(snapshot, arg, kv);
  if (!symbol) {
    return observation("O TESTS", "matches=0 reason=symbol_not_found", { tests: [] });
  }
  const tests = testsForSymbol(snapshot, symbol);
  return observation(
    "O TESTS",
    [
      `symbol=${symbol.id}`,
      `matches=${tests.length}`,
      tests.length > 0 ? `tests=${tests.map((test) => test.id).join(",")}` : "tests=none",
    ].join(" "),
    { symbol, tests },
  );
}

function impactObservation(snapshot: CairSnapshot, arg: string | undefined, kv: Map<string, string>): CairObservation {
  const symbol = findSymbol(snapshot, arg, kv);
  if (!symbol) {
    return observation("O IMPACT", "matches=0 reason=symbol_not_found", { tests: [] });
  }
  const tests = testsForSymbol(snapshot, symbol);
  const sameFileSymbols = snapshot.lexicon.symbols.filter((candidate) => candidate.file === symbol.file);
  return observation(
    "O IMPACT",
    [
      `target=${symbol.id}`,
      `tests=${tests.map((test) => test.id).join(",") || "none"}`,
      `symbolsInFile=${sameFileSymbols.length}`,
      `risk=${tests.length === 0 ? "unknown" : tests.length > 3 ? "medium" : "low"}`,
    ].join(" "),
    {
      symbol,
      tests,
      sameFileSymbols,
      nextActions: tests.map((test) => `forge test run ${test.file} --json`),
    },
  );
}

function depApiObservations(snapshot: CairSnapshot, parts: string[], kv: Map<string, string>): CairObservation[] {
  const packageArg = kv.get("package") ?? kv.get("pkg") ?? parts.find((part) => part.startsWith("P#"));
  const symbolArg = kv.get("symbol") ?? kv.get("name") ?? parts.find((part) => !part.includes("=") && !part.startsWith("P#"));
  const packageName = packageArg?.startsWith("P#")
    ? snapshot.lexicon.packages.find((pkg) => pkg.id === packageArg)?.name
    : packageArg;

  if (!packageName && !symbolArg) {
    return [observation("O DEP.API", "matches=0 reason=missing_package_or_symbol")];
  }

  const matches = snapshot.lexicon.apis.filter((api) =>
    (!packageName || api.packageName === packageName) &&
    (!symbolArg || api.name === symbolArg || api.name.toLowerCase().includes(symbolArg.toLowerCase())),
  );

  if (matches.length === 0) {
    return [
      observation(
        "O DEP.API",
        [
          "matches=0",
          packageName ? `package=${packageName}` : null,
          symbolArg ? `symbol=${symbolArg}` : null,
        ].filter(Boolean).join(" "),
      ),
    ];
  }

  return matches.slice(0, 12).map((api) =>
    observation(
      "O DEP.API",
      [
        api.id,
        `package=${api.packageName}`,
        `entry=${api.entrypoint}`,
        `name=${api.name}`,
        `kind=${api.kind}`,
        `sig=${JSON.stringify(api.signature)}`,
      ].join(" "),
      { api },
    ),
  );
}

function helpObservations(): CairObservation[] {
  return [
    observation("O HELP", "Q STATUS"),
    observation("O HELP", "Q ST"),
    observation("O HELP", "Q CHANGED"),
    observation("O HELP", "Q C"),
    observation("O HELP", "Q SYMBOL S#1"),
    observation("O HELP", "Q S S#1"),
    observation("O HELP", "Q SYMBOL name=<symbol>"),
    observation("O HELP", "Q DEF S#1"),
    observation("O HELP", "Q REFS S#1"),
    observation("O HELP", "Q IMPACT S#1"),
    observation("O HELP", "Q MODULE M#1"),
    observation("O HELP", "Q M M#1"),
    observation("O HELP", "Q TESTS S#1"),
    observation("O HELP", "Q T S#1"),
    observation("O HELP", "Q DEP.API package=<pkg> symbol=<export>"),
    observation("O HELP", "A CREATE.FILE path=<repo-path> <<CODE ... CODE"),
    observation("O HELP", "A CREATE.SYMBOL path=<repo-path>|file=M#1 kind=function name=<symbol> export=true"),
    observation("O HELP", "A PATCH path=<repo-path> span=<start:end> hash=<sha256-prefix> <<CODE ... CODE"),
    observation("O HELP", "A ADD.IMPORT file=M#1 symbol=<name> from=<specifier>"),
    observation("O HELP", "A ADD.EXPORT path=<repo-path> symbol=<name> from=<specifier>"),
    observation("O HELP", "A RENAME.SYMBOL target=S#1 newName=<name> expect.file=<path> expect.kind=<kind> expect.hash=<hash>"),
    observation("O HELP", "A MOVE.SYMBOL target=S#1 to=<M#|path> expect.file=<path> expect.kind=<kind> expect.hash=<hash>"),
    observation("O HELP", "A UPDATE.SIGNATURE target=S#1 signature=<signature> expect.file=<path> expect.kind=<kind> expect.hash=<hash>"),
    observation("O HELP", "A ADD.PARAM target=S#1 name=<param> type=<type> expect.file=<path> expect.kind=<kind> expect.hash=<hash>"),
    observation("O HELP", "A UPDATE.CALLSITES target=S#1 appendArg=<expr> expect.file=<path> expect.kind=<kind> expect.hash=<hash>"),
    observation("O HELP", "A ORGANIZE.IMPORTS file=M#1"),
    observation("O HELP", "A FORMAT file=M#1"),
    observation("O HELP", "A FIND.PATTERN scope=src pattern=<ast-ish-pattern>"),
    observation("O HELP", "A REWRITE.PATTERN scope=src pattern=<pattern> replacement=<replacement>"),
    observation("O HELP", "A MAKE.COMMAND name=<name>"),
    observation("O HELP", "A MAKE.QUERY name=<name>"),
    observation("O HELP", "A MAKE.ACTION name=<name>"),
    observation("O HELP", "A MAKE.TABLE name=<name> fields=<fields>"),
    observation("O HELP", "A ADD.TEST target=S#1 kind=unit"),
    observation("O HELP", "A WIRE.EXPORT target=S#1 file=src/index.ts"),
    observation("O HELP", "A ROLLBACK journal=<path>"),
    observation("O HELP", "A APPLY plan=<P#|path>"),
    observation("O HELP", "A RN t=S#1 nn=<name>"),
    observation("O HELP", "A OI f=M#1"),
    observation("O HELP", "A FMT f=M#1"),
    observation("O HELP", "A MC n=<name>"),
    observation("O HELP", "A AT t=S#1"),
    observation("O HELP", "A WX t=S#1"),
    observation("O HELP", "V TYPECHECK"),
    observation("O HELP", "V IMPACT target=S#1"),
  ];
}

function normalizeQueryVerb(value: string | undefined): string | undefined {
  const upper = value?.toUpperCase();
  switch (upper) {
    case "ST":
      return "STATUS";
    case "C":
      return "CHANGED";
    case "S":
      return "SYMBOL";
    case "D":
      return "DEF";
    case "R":
      return "REFS";
    case "I":
      return "IMPACT";
    case "M":
      return "MODULE";
    case "T":
      return "TESTS";
    case "API":
      return "DEP.API";
    case "H":
      return "HELP";
    default:
      return upper;
  }
}

export function runCairQuery(
  snapshot: CairSnapshot,
  query: string,
  workspaceRoot: string,
): CairQueryResult {
  const parts = tokens(query);
  if (parts.length === 0) {
    return error(query, "empty CAIR query");
  }
  if (parts[0]?.toUpperCase() !== "Q") {
    return error(query, "CAIR query must start with Q");
  }
  const verb = normalizeQueryVerb(parts[1]);
  const rest = parts.slice(2);
  const kv = keyValues(rest);
  const diagnostics: Diagnostic[] = [];
  let observations: CairObservation[];

  switch (verb) {
    case "STATUS":
      observations = statusObservations(snapshot);
      break;
    case "CHANGED":
      observations = [changedObservation(workspaceRoot)];
      break;
    case "SYMBOL": {
      const symbol = findSymbol(snapshot, rest.find((part) => !part.includes("=")), kv);
      observations = symbol
        ? [symbolObservation(symbol)]
        : [observation("O SYMBOL", "matches=0 reason=symbol_not_found")];
      break;
    }
    case "DEF":
      observations = [definitionObservation(snapshot, workspaceRoot, rest.find((part) => !part.includes("=")), kv)];
      break;
    case "REFS":
      observations = [refsObservation(snapshot, workspaceRoot, rest.find((part) => !part.includes("=")), kv)];
      break;
    case "IMPACT":
      observations = [impactObservation(snapshot, rest.find((part) => !part.includes("=")), kv)];
      break;
    case "MODULE": {
      const module = findModuleObservation(snapshot, rest.find((part) => !part.includes("=")));
      observations = module ? [module] : [observation("O MODULE", "matches=0 reason=module_not_found")];
      break;
    }
    case "TESTS":
      observations = [testsObservation(snapshot, rest.find((part) => !part.includes("=")), kv)];
      break;
    case "DEP.API":
      observations = depApiObservations(snapshot, rest, kv);
      break;
    case "HELP":
    case undefined:
      observations = helpObservations();
      break;
    default:
      return error(query, `unknown CAIR query verb '${verb}'`);
  }

  return { ok: diagnostics.length === 0, query, observations, diagnostics };
}
