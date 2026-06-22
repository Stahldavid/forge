import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { planMakeCommand } from "../make/index.ts";
import type { MakeCommandOptions, MakePrimitive } from "../make/types.ts";
import type {
  CairActionResult,
  CairActionStepResult,
  CairFileChange,
  CairObservation,
  CairParsedAction,
  CairSnapshot,
  CairSymbolRef,
} from "./types.ts";
import { parseCairAction, parseCairActionScript } from "./action-parser.ts";
import { writeCairActionJournal, writeCairActionPlan } from "./action-journal.ts";
import { validateSemanticExpectations } from "./action-validator.ts";
export { splitCairActionScript } from "./action-parser.ts";

interface CairActionRunOptions {
  workspaceRoot: string;
  snapshot: CairSnapshot;
  script: string;
  dryRun: boolean;
  plan: boolean;
  allowGenerated: boolean;
}

interface ResolvedPath {
  repoPath: string;
  absolutePath: string;
}

interface ResolvedTextTarget {
  path: ResolvedPath;
  span?: { start: number; end: number };
  symbolHash?: string;
}

function observation(code: string, text: string, data?: Record<string, unknown>): CairObservation {
  return data ? { code, text, data } : { code, text };
}

function actionError(message: string, file?: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_CAIR_ACTION",
    message,
    ...(file ? { file } : {}),
  });
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(expected);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function isGeneratedPath(repoPath: string): boolean {
  return repoPath.split("/").includes("_generated");
}

function resolveRepoPath(
  workspaceRoot: string,
  value: string,
  allowGenerated: boolean,
): { path?: ResolvedPath; diagnostic?: Diagnostic } {
  const normalized = normalizeSlashes(value.trim());
  if (!normalized || normalized.includes("\0")) {
    return { diagnostic: actionError("CAIR path is empty or invalid") };
  }
  if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
    return { diagnostic: actionError(`CAIR paths must be repo-relative: ${value}`) };
  }
  const absolutePath = resolve(workspaceRoot, normalized);
  const repoPath = normalizeSlashes(relative(workspaceRoot, absolutePath));
  if (!repoPath || repoPath === "." || repoPath.startsWith("../") || repoPath === "..") {
    return { diagnostic: actionError(`CAIR path escapes the workspace: ${value}`) };
  }
  if (!allowGenerated && isGeneratedPath(repoPath)) {
    return {
      diagnostic: actionError(
        `CAIR refuses to edit generated files without --include-generated: ${repoPath}`,
        repoPath,
      ),
    };
  }
  return { path: { repoPath, absolutePath } };
}

function resolveModulePath(snapshot: CairSnapshot, id: string): string | null {
  return snapshot.lexicon.modules.find((module) => module.id === id)?.file ?? null;
}

function resolveSymbolTarget(
  snapshot: CairSnapshot,
  id: string,
): { file: string; span: { start: number; end: number }; hash: string } | null {
  const symbol = snapshot.lexicon.symbols.find((candidate) => candidate.id === id);
  if (!symbol) {
    return null;
  }
  return { file: symbol.file, span: symbol.span, hash: symbol.hash };
}

function resolveSymbolRef(snapshot: CairSnapshot, id: string | undefined): CairSymbolRef | null {
  if (!id?.startsWith("S#")) {
    return null;
  }
  return snapshot.lexicon.symbols.find((candidate) => candidate.id === id) ?? null;
}

function resolveActionPath(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  allowGenerated: boolean,
): { path?: ResolvedPath; diagnostic?: Diagnostic } {
  const value = action.args.path ?? action.args.file;
  if (!value) {
    return { diagnostic: actionError(`${action.verb} requires path=<repo-path> or file=<M#|repo-path>`) };
  }
  const repoPath = value.startsWith("M#") ? resolveModulePath(snapshot, value) : value;
  if (!repoPath) {
    return { diagnostic: actionError(`module reference not found: ${value}`) };
  }
  return resolveRepoPath(workspaceRoot, repoPath, allowGenerated);
}

function resolveTextTarget(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  allowGenerated: boolean,
): { target?: ResolvedTextTarget; diagnostic?: Diagnostic } {
  const targetRef = action.args.target;
  if (targetRef?.startsWith("S#")) {
    const symbol = resolveSymbolTarget(snapshot, targetRef);
    if (!symbol) {
      return { diagnostic: actionError(`symbol reference not found: ${targetRef}`) };
    }
    const resolved = resolveRepoPath(workspaceRoot, symbol.file, allowGenerated);
    if (resolved.diagnostic || !resolved.path) {
      return { diagnostic: resolved.diagnostic };
    }
    return { target: { path: resolved.path, span: symbol.span, symbolHash: symbol.hash } };
  }

  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return { diagnostic: resolved.diagnostic };
  }
  const span = parseSpan(action.args.span);
  if (action.args.span && !span) {
    return { diagnostic: actionError(`invalid span '${action.args.span}'`, resolved.path.repoPath) };
  }
  return { target: { path: resolved.path, ...(span ? { span } : {}) } };
}

function parseSpan(value: string | undefined): { start: number; end: number } | null {
  if (!value) {
    return null;
  }
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return null;
  }
  return { start, end };
}

function actionText(action: CairParsedAction): string | null {
  return action.body ?? action.args.text ?? action.args.replacement ?? action.args.content ?? null;
}

function symbolDeclaration(action: CairParsedAction): { declaration?: string; diagnostic?: Diagnostic } {
  const name = action.args.name ?? action.args.symbol;
  const kind = (action.args.kind ?? "function").toLowerCase();
  const explicit = actionText(action);
  if (explicit !== null) {
    if (name && !explicit.includes(name)) {
      return { diagnostic: actionError(`CREATE.SYMBOL body does not contain symbol name '${name}'`) };
    }
    return { declaration: explicit.trimEnd() };
  }
  if (!name) {
    return { diagnostic: actionError("CREATE.SYMBOL requires name=<symbol> when no body is provided") };
  }

  const exported = action.args.export === "true" ? "export " : "";
  switch (kind) {
    case "function":
      return { declaration: `${exported}function ${name}() {\n  throw new Error("not implemented");\n}` };
    case "const":
      return { declaration: `${exported}const ${name} = undefined;` };
    case "type":
      return { declaration: `${exported}type ${name} = unknown;` };
    case "interface":
      return { declaration: `${exported}interface ${name} {\n}` };
    case "class":
      return { declaration: `${exported}class ${name} {\n}` };
    default:
      return { diagnostic: actionError(`unsupported CREATE.SYMBOL kind '${kind}'`) };
  }
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function maybeWrite(path: string, content: string, dryRun: boolean): void {
  if (dryRun) {
    return;
  }
  ensureParentDir(path);
  writeFileSync(path, content, "utf8");
}

function createFileAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve path")]);
  }
  const content = actionText(action) ?? "";
  const exists = existsSync(resolved.path.absolutePath);
  const overwrite = action.args.overwrite === "true";
  const ifMissing = action.args.ifmissing !== "false";
  if (exists && !overwrite) {
    if (ifMissing) {
      const before = readFileSync(resolved.path.absolutePath, "utf8");
      const changes: CairFileChange[] = [{
        path: resolved.path.repoPath,
        operation: "noop",
        beforeHash: hashText(before),
        bytesBefore: byteLength(before),
      }];
      return completedStep(action, dryRun, false, [
        observation("O FILE.EXISTS", `path=${resolved.path.repoPath} action=noop`),
      ], changes, workspaceRoot);
    }
    return failedStep(action, dryRun, [actionError(`file already exists: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }

  const before = exists ? readFileSync(resolved.path.absolutePath, "utf8") : "";
  maybeWrite(resolved.path.absolutePath, content, dryRun);
  const changes: CairFileChange[] = [{
    path: resolved.path.repoPath,
    operation: "create",
    ...(exists ? { beforeHash: hashText(before), bytesBefore: byteLength(before) } : {}),
    afterHash: hashText(content),
    bytesAfter: byteLength(content),
    ...(exists ? { beforeContent: before } : {}),
    afterContent: content,
  }];
  return completedStep(action, dryRun, !dryRun, [
    observation(
      dryRun ? "O FILE.PLAN" : "O FILE.CREATED",
      `path=${resolved.path.repoPath} bytes=${byteLength(content)}${dryRun ? " dryRun=true" : ""}`,
      { changes },
    ),
  ], changes, workspaceRoot);
}

function createSymbolAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const afterRef = action.args.after;
  const afterSymbol = afterRef?.startsWith("S#") ? resolveSymbolTarget(snapshot, afterRef) : null;
  const pathValue = action.args.path ?? action.args.file ?? afterSymbol?.file;
  if (!pathValue) {
    return failedStep(action, dryRun, [actionError("CREATE.SYMBOL requires path=<repo-path>, file=<M#|repo-path>, or after=<S#>")]);
  }

  const pathAction: CairParsedAction = {
    ...action,
    args: { ...action.args, path: pathValue },
  };
  const resolved = resolveActionPath(pathAction, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve symbol target")]);
  }

  const declaration = symbolDeclaration(action);
  if (declaration.diagnostic || declaration.declaration === undefined) {
    return failedStep(action, dryRun, [declaration.diagnostic ?? actionError("failed to build symbol declaration", resolved.path.repoPath)]);
  }

  const createFile = action.args.createfile === "true" || action.args["create-file"] === "true";
  const existed = existsSync(resolved.path.absolutePath);
  if (!existed && !createFile) {
    return failedStep(action, dryRun, [actionError(`file not found: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }

  const current = existed
    ? readFileSync(resolved.path.absolutePath, "utf8")
    : "";
  const name = action.args.name ?? action.args.symbol;
  if (name && current.includes(name) && action.args.overwrite !== "true") {
    const changes: CairFileChange[] = [{
      path: resolved.path.repoPath,
      operation: "noop",
      beforeHash: hashText(current),
      bytesBefore: byteLength(current),
    }];
    return completedStep(action, dryRun, false, [
      observation("O SYMBOL.EXISTS", `path=${resolved.path.repoPath} name=${name} action=noop`),
    ], changes, workspaceRoot);
  }

  let insertAt = current.length;
  if (afterRef?.startsWith("S#")) {
    if (!afterSymbol) {
      return failedStep(action, dryRun, [actionError(`symbol reference not found: ${afterRef}`)]);
    }
    if (normalizeSlashes(afterSymbol.file) !== resolved.path.repoPath) {
      return failedStep(action, dryRun, [actionError(`after=${afterRef} is in ${afterSymbol.file}, not ${resolved.path.repoPath}`, resolved.path.repoPath)]);
    }
    insertAt = afterSymbol.span.end;
  }

  const prefix = current.slice(0, insertAt);
  const suffix = current.slice(insertAt);
  const beforeGap = prefix.length === 0 || prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n";
  const afterGap = suffix.length === 0 || suffix.startsWith("\n") ? "\n" : "\n\n";
  const next = `${prefix}${beforeGap}${declaration.declaration}${afterGap}${suffix}`;
  maybeWrite(resolved.path.absolutePath, next, dryRun);
  const changes: CairFileChange[] = [{
    path: resolved.path.repoPath,
    operation: existed ? "insert" : "create",
    beforeHash: hashText(current),
    afterHash: hashText(next),
    bytesBefore: byteLength(current),
    bytesAfter: byteLength(next),
    beforeContent: current,
    afterContent: next,
  }];
  return completedStep(action, dryRun, !dryRun, [
    observation(
      dryRun ? "O SYMBOL.PLAN" : "O SYMBOL.CREATED",
      [
        `path=${resolved.path.repoPath}`,
        name ? `name=${name}` : null,
        `kind=${action.args.kind ?? "body"}`,
        afterRef ? `after=${afterRef}` : null,
        dryRun ? "dryRun=true" : null,
      ].filter(Boolean).join(" "),
      { changes },
    ),
  ], changes, workspaceRoot);
}

function patchAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveTextTarget(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.target) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve patch target")]);
  }
  if (!existsSync(resolved.target.path.absolutePath)) {
    return failedStep(action, dryRun, [actionError(`file not found: ${resolved.target.path.repoPath}`, resolved.target.path.repoPath)]);
  }
  const replacement = actionText(action);
  if (replacement === null) {
    return failedStep(action, dryRun, [actionError("PATCH requires replacement text or a <<CODE body", resolved.target.path.repoPath)]);
  }

  const current = readFileSync(resolved.target.path.absolutePath, "utf8");
  const span = resolved.target.span ?? { start: 0, end: current.length };
  if (span.end > current.length) {
    return failedStep(action, dryRun, [actionError(`span ${span.start}:${span.end} exceeds file length`, resolved.target.path.repoPath)]);
  }

  const expectHash = action.args["expect.hash"];
  if (expectHash && resolved.target.symbolHash && resolved.target.symbolHash !== expectHash) {
    return failedStep(action, dryRun, [
      actionError(`symbol hash mismatch for ${action.args.target}: expected ${expectHash}, got ${resolved.target.symbolHash}`, resolved.target.path.repoPath),
    ]);
  }

  const selected = current.slice(span.start, span.end);
  const selectedHash = hashText(selected);
  const guardHash = action.args.hash;
  if (!guardHash) {
    return failedStep(action, dryRun, [actionError("PATCH requires hash=<sha256-prefix-of-current-span>", resolved.target.path.repoPath)]);
  }
  if (!hashMatches(selectedHash, guardHash)) {
    return failedStep(action, dryRun, [
      actionError(`patch hash mismatch: expected ${guardHash}, got ${selectedHash}`, resolved.target.path.repoPath),
    ]);
  }

  const next = `${current.slice(0, span.start)}${replacement}${current.slice(span.end)}`;
  maybeWrite(resolved.target.path.absolutePath, next, dryRun);
  const changes: CairFileChange[] = [{
    path: resolved.target.path.repoPath,
    operation: "patch",
    beforeHash: hashText(current),
    afterHash: hashText(next),
    bytesBefore: byteLength(current),
    bytesAfter: byteLength(next),
    beforeContent: current,
    afterContent: next,
  }];
  return completedStep(action, dryRun, !dryRun, [
    observation(
      dryRun ? "O PATCH.PLAN" : "O PATCH.APPLIED",
      [
        `path=${resolved.target.path.repoPath}`,
        `span=${span.start}:${span.end}`,
        `before=${selectedHash.slice(0, 12)}`,
        `after=${hashText(replacement).slice(0, 12)}`,
        dryRun ? "dryRun=true" : null,
      ].filter(Boolean).join(" "),
      { changes },
    ),
  ], changes, workspaceRoot);
}

function formattedNamedImport(symbol: string, from: string, isType: boolean): string {
  return `import ${isType ? "type " : ""}{ ${symbol} } from "${from}";`;
}

function formattedNamedExport(symbol: string, from: string): string {
  return `export { ${symbol} } from "${from}";`;
}

function addImportAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve import target")]);
  }
  const symbol = action.args.symbol ?? action.args.name;
  const from = action.args.from;
  if (!symbol || !from) {
    return failedStep(action, dryRun, [actionError("ADD.IMPORT requires symbol=<name> and from=<specifier>", resolved.path.repoPath)]);
  }
  if (!existsSync(resolved.path.absolutePath)) {
    return failedStep(action, dryRun, [actionError(`file not found: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }

  const current = readFileSync(resolved.path.absolutePath, "utf8");
  const importLine = formattedNamedImport(symbol, from, action.args.type === "true");
  if (current.includes(importLine)) {
    const changes: CairFileChange[] = [{
      path: resolved.path.repoPath,
      operation: "noop",
      beforeHash: hashText(current),
      bytesBefore: byteLength(current),
    }];
    return completedStep(action, dryRun, false, [
      observation("O IMPORT.EXISTS", `path=${resolved.path.repoPath} symbol=${symbol} from=${from} action=noop`),
    ], changes, workspaceRoot);
  }

  const lines = current.split("\n");
  let insertAt = 0;
  if (lines[0]?.startsWith("#!")) {
    insertAt = 1;
  }
  for (let index = insertAt; index < lines.length; index++) {
    const trimmed = lines[index]?.trim() ?? "";
    if (trimmed.startsWith("import ")) {
      insertAt = index + 1;
      continue;
    }
    if (!trimmed) {
      continue;
    }
    break;
  }
  lines.splice(insertAt, 0, importLine);
  const next = lines.join("\n");
  maybeWrite(resolved.path.absolutePath, next, dryRun);
  const changes: CairFileChange[] = [{
    path: resolved.path.repoPath,
    operation: "insert",
    beforeHash: hashText(current),
    afterHash: hashText(next),
    bytesBefore: byteLength(current),
    bytesAfter: byteLength(next),
    beforeContent: current,
    afterContent: next,
  }];
  return completedStep(action, dryRun, !dryRun, [
    observation(
      dryRun ? "O IMPORT.PLAN" : "O IMPORT.ADDED",
      `path=${resolved.path.repoPath} symbol=${symbol} from=${from}${dryRun ? " dryRun=true" : ""}`,
      { changes },
    ),
  ], changes, workspaceRoot);
}

function addExportAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve export target")]);
  }
  const symbol = action.args.symbol ?? action.args.name;
  const from = action.args.from;
  if (!symbol || !from) {
    return failedStep(action, dryRun, [actionError("ADD.EXPORT requires symbol=<name> and from=<specifier>", resolved.path.repoPath)]);
  }
  if (!existsSync(resolved.path.absolutePath)) {
    return failedStep(action, dryRun, [actionError(`file not found: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }

  const current = readFileSync(resolved.path.absolutePath, "utf8");
  const exportLine = formattedNamedExport(symbol, from);
  if (current.includes(exportLine)) {
    const changes: CairFileChange[] = [{
      path: resolved.path.repoPath,
      operation: "noop",
      beforeHash: hashText(current),
      bytesBefore: byteLength(current),
    }];
    return completedStep(action, dryRun, false, [
      observation("O EXPORT.EXISTS", `path=${resolved.path.repoPath} symbol=${symbol} from=${from} action=noop`),
    ], changes, workspaceRoot);
  }

  const separator = current.endsWith("\n") || current.length === 0 ? "" : "\n";
  const next = `${current}${separator}${exportLine}\n`;
  maybeWrite(resolved.path.absolutePath, next, dryRun);
  const changes: CairFileChange[] = [{
    path: resolved.path.repoPath,
    operation: "append",
    beforeHash: hashText(current),
    afterHash: hashText(next),
    bytesBefore: byteLength(current),
    bytesAfter: byteLength(next),
    beforeContent: current,
    afterContent: next,
  }];
  return completedStep(action, dryRun, !dryRun, [
    observation(
      dryRun ? "O EXPORT.PLAN" : "O EXPORT.ADDED",
      `path=${resolved.path.repoPath} symbol=${symbol} from=${from}${dryRun ? " dryRun=true" : ""}`,
      { changes },
    ),
  ], changes, workspaceRoot);
}

function readTsConfig(workspaceRoot: string, snapshot: CairSnapshot): {
  rootNames: string[];
  options: ts.CompilerOptions;
} {
  const configPath = ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    return {
      rootNames: snapshot.lexicon.modules
        .map((module) => resolve(workspaceRoot, module.file))
        .filter((file) => existsSync(file)),
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        strict: true,
      },
    };
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    return { rootNames: [], options: {} };
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
  );
  return { rootNames: parsed.fileNames, options: parsed.options };
}

function buildLanguageService(workspaceRoot: string, snapshot: CairSnapshot): ts.LanguageService {
  const config = readTsConfig(workspaceRoot, snapshot);
  const rootNames = new Set(config.rootNames.map((file) => resolve(file)));
  for (const module of snapshot.lexicon.modules) {
    const absolute = resolve(workspaceRoot, module.file);
    if (existsSync(absolute)) {
      rootNames.add(absolute);
    }
  }
  const versions = new Map<string, string>();
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...rootNames],
    getScriptVersion: (fileName) => versions.get(resolve(fileName)) ?? "0",
    getScriptSnapshot: (fileName) => {
      if (!existsSync(fileName)) {
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf8"));
    },
    getCurrentDirectory: () => workspaceRoot,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host);
}

function symbolNamePosition(symbol: CairSymbolRef, source: string): number {
  const selected = source.slice(symbol.span.start, symbol.span.end);
  const local = selected.indexOf(symbol.name);
  return local >= 0 ? symbol.span.start + local : symbol.span.start;
}

function applyFileRewrites(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
  rewrites: Array<{ absolutePath: string; next: string }>,
  code: string,
): CairActionStepResult {
  const changes: CairFileChange[] = [];
  for (const rewrite of rewrites) {
    const repoPath = normalizeSlashes(relative(workspaceRoot, rewrite.absolutePath));
    const resolved = resolveRepoPath(workspaceRoot, repoPath, action.args["allow-generated"] === "true");
    if (resolved.diagnostic || !resolved.path) {
      return failedStep(action, dryRun, [resolved.diagnostic ?? actionError(`failed to resolve rewrite target ${repoPath}`)]);
    }
    const current = existsSync(resolved.path.absolutePath)
      ? readFileSync(resolved.path.absolutePath, "utf8")
      : "";
    if (current === rewrite.next) {
      continue;
    }
    maybeWrite(resolved.path.absolutePath, rewrite.next, dryRun);
    changes.push({
      path: resolved.path.repoPath,
      operation: "patch",
      beforeHash: hashText(current),
      afterHash: hashText(rewrite.next),
      bytesBefore: byteLength(current),
      bytesAfter: byteLength(rewrite.next),
      beforeContent: current,
      afterContent: rewrite.next,
    });
  }
  return completedStep(action, dryRun, !dryRun && changes.length > 0, [
    observation(
      dryRun ? `${code}.PLAN` : `${code}.APPLIED`,
      `changes=${changes.length}${dryRun ? " dryRun=true" : ""}`,
      { changes },
    ),
  ], changes, workspaceRoot);
}

function applyTextChangesToContent(text: string, changes: readonly ts.TextChange[]): string {
  let next = text;
  for (const change of [...changes].sort((left, right) => right.span.start - left.span.start)) {
    next = `${next.slice(0, change.span.start)}${change.newText}${next.slice(change.span.start + change.span.length)}`;
  }
  return next;
}

function applyLanguageServiceChanges(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
  changesByFile: Map<string, readonly ts.TextChange[]>,
  code: string,
): CairActionStepResult {
  const rewrites: Array<{ absolutePath: string; next: string }> = [];
  for (const [fileName, changes] of changesByFile) {
    const absolutePath = resolve(fileName);
    if (!existsSync(absolutePath) || changes.length === 0) {
      continue;
    }
    rewrites.push({
      absolutePath,
      next: applyTextChangesToContent(readFileSync(absolutePath, "utf8"), changes),
    });
  }
  return applyFileRewrites(action, workspaceRoot, dryRun, rewrites, code);
}

function renameSymbolAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("RENAME.SYMBOL requires target=<S#>")]);
  }
  const expectationErrors = validateSemanticExpectations(action, symbol);
  if (expectationErrors.length > 0) {
    return failedStep(action, dryRun, expectationErrors);
  }
  const newName = action.args.newname ?? action.args.name;
  if (!newName) {
    return failedStep(action, dryRun, [actionError("RENAME.SYMBOL requires newName=<identifier>", symbol.file)]);
  }
  const absolute = resolve(workspaceRoot, symbol.file);
  if (!existsSync(absolute)) {
    return failedStep(action, dryRun, [actionError(`file not found: ${symbol.file}`, symbol.file)]);
  }
  const service = buildLanguageService(workspaceRoot, snapshot);
  const position = symbolNamePosition(symbol, readFileSync(absolute, "utf8"));
  const locations = service.findRenameLocations(absolute, position, false, false, { providePrefixAndSuffixTextForRename: false }) ?? [];
  if (locations.length === 0) {
    return failedStep(action, dryRun, [actionError(`no rename locations found for ${symbol.id}`, symbol.file)]);
  }
  const changesByFile = new Map<string, ts.TextChange[]>();
  for (const location of locations) {
    const existing = changesByFile.get(location.fileName) ?? [];
    existing.push({ span: location.textSpan, newText: newName });
    changesByFile.set(location.fileName, existing);
  }
  return applyLanguageServiceChanges(action, workspaceRoot, dryRun, changesByFile, "O RENAME");
}

function moveSymbolAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("MOVE.SYMBOL requires target=<S#>")]);
  }
  const expectationErrors = validateSemanticExpectations(action, symbol);
  if (expectationErrors.length > 0) {
    return failedStep(action, dryRun, expectationErrors);
  }
  const source = resolveRepoPath(workspaceRoot, symbol.file, allowGenerated);
  const destinationRef = action.args.to ?? action.args.file ?? action.args.path;
  if (!destinationRef) {
    return failedStep(action, dryRun, [actionError("MOVE.SYMBOL requires to=<M#|repo-path>", symbol.file)]);
  }
  const destinationPath = destinationRef.startsWith("M#")
    ? resolveModulePath(snapshot, destinationRef)
    : destinationRef;
  if (!destinationPath) {
    return failedStep(action, dryRun, [actionError(`module reference not found: ${destinationRef}`)]);
  }
  const destination = resolveRepoPath(workspaceRoot, destinationPath, allowGenerated);
  if (source.diagnostic || !source.path || destination.diagnostic || !destination.path) {
    return failedStep(action, dryRun, [
      source.diagnostic ?? destination.diagnostic ?? actionError("failed to resolve MOVE.SYMBOL paths"),
    ]);
  }
  const sourceText = readFileSync(source.path.absolutePath, "utf8");
  const declaration = sourceText.slice(symbol.span.start, symbol.span.end).trim();
  const nextSource = `${sourceText.slice(0, symbol.span.start)}${sourceText.slice(symbol.span.end)}`.replace(/\n{3,}/g, "\n\n");
  const destinationText = existsSync(destination.path.absolutePath)
    ? readFileSync(destination.path.absolutePath, "utf8")
    : "";
  const nextDestination = `${destinationText}${destinationText.endsWith("\n") || !destinationText ? "" : "\n"}${declaration}\n`;
  return applyFileRewrites(action, workspaceRoot, dryRun, [
    { absolutePath: source.path.absolutePath, next: nextSource },
    { absolutePath: destination.path.absolutePath, next: nextDestination },
  ], "O MOVE");
}

function updateSignatureAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("UPDATE.SIGNATURE requires target=<S#>")]);
  }
  const expectationErrors = validateSemanticExpectations(action, symbol);
  if (expectationErrors.length > 0) {
    return failedStep(action, dryRun, expectationErrors);
  }
  const signature = action.args.signature ?? action.body;
  if (!signature) {
    return failedStep(action, dryRun, [actionError("UPDATE.SIGNATURE requires signature=<text> or body", symbol.file)]);
  }
  const resolved = resolveRepoPath(workspaceRoot, symbol.file, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve signature target")]);
  }
  const current = readFileSync(resolved.path.absolutePath, "utf8");
  const selected = current.slice(symbol.span.start, symbol.span.end);
  const braceIndex = selected.indexOf("{");
  if (braceIndex < 0) {
    return failedStep(action, dryRun, [actionError("UPDATE.SIGNATURE only supports block declarations", symbol.file)]);
  }
  const replacement = `${signature.trim()} `;
  const next = `${current.slice(0, symbol.span.start)}${replacement}${selected.slice(braceIndex)}${current.slice(symbol.span.end)}`;
  return applyFileRewrites(action, workspaceRoot, dryRun, [{ absolutePath: resolved.path.absolutePath, next }], "O SIGNATURE");
}

function addParamAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("ADD.PARAM requires target=<S#>")]);
  }
  const expectationErrors = validateSemanticExpectations(action, symbol);
  if (expectationErrors.length > 0) {
    return failedStep(action, dryRun, expectationErrors);
  }
  const name = action.args.name;
  const type = action.args.type ?? "unknown";
  if (!name) {
    return failedStep(action, dryRun, [actionError("ADD.PARAM requires name=<param>", symbol.file)]);
  }
  const defaultValue = action.args.default;
  const param = `${name}: ${type}${defaultValue ? ` = ${defaultValue}` : ""}`;
  const resolved = resolveRepoPath(workspaceRoot, symbol.file, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve parameter target")]);
  }
  const current = readFileSync(resolved.path.absolutePath, "utf8");
  const selected = current.slice(symbol.span.start, symbol.span.end);
  const open = selected.indexOf("(");
  const close = selected.indexOf(")", open + 1);
  if (open < 0 || close < 0) {
    return failedStep(action, dryRun, [actionError("ADD.PARAM only supports declarations with parameter lists", symbol.file)]);
  }
  const existing = selected.slice(open + 1, close).trim();
  const nextParams = existing ? `${existing}, ${param}` : param;
  const nextSelected = `${selected.slice(0, open + 1)}${nextParams}${selected.slice(close)}`;
  const next = `${current.slice(0, symbol.span.start)}${nextSelected}${current.slice(symbol.span.end)}`;
  return applyFileRewrites(action, workspaceRoot, dryRun, [{ absolutePath: resolved.path.absolutePath, next }], "O PARAM");
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function updateCallsitesAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("UPDATE.CALLSITES requires target=<S#>")]);
  }
  const expectationErrors = validateSemanticExpectations(action, symbol);
  if (expectationErrors.length > 0) {
    return failedStep(action, dryRun, expectationErrors);
  }
  const appendArg = action.args.appendarg ?? action.args.arg ?? action.body;
  if (!appendArg) {
    return failedStep(action, dryRun, [actionError("UPDATE.CALLSITES requires appendArg=<expr> or body", symbol.file)]);
  }
  const service = buildLanguageService(workspaceRoot, snapshot);
  const absolute = resolve(workspaceRoot, symbol.file);
  const position = symbolNamePosition(symbol, readFileSync(absolute, "utf8"));
  const references = service.getReferencesAtPosition(absolute, position) ?? [];
  const rewritesByFile = new Map<string, string>();
  for (const reference of references) {
    const fileName = resolve(reference.fileName);
    if (fileName === absolute && reference.textSpan.start === position) {
      continue;
    }
    if (!existsSync(fileName)) {
      continue;
    }
    const text = rewritesByFile.get(fileName) ?? readFileSync(fileName, "utf8");
    const afterName = reference.textSpan.start + reference.textSpan.length;
    const open = text.slice(afterName).search(/\S/);
    const openIndex = open >= 0 ? afterName + open : -1;
    if (openIndex < 0 || text[openIndex] !== "(") {
      continue;
    }
    const closeIndex = findMatchingParen(text, openIndex);
    if (closeIndex < 0) {
      continue;
    }
    const existing = text.slice(openIndex + 1, closeIndex).trim();
    const insertion = existing ? `, ${appendArg.trim()}` : appendArg.trim();
    rewritesByFile.set(fileName, `${text.slice(0, closeIndex)}${insertion}${text.slice(closeIndex)}`);
  }
  return applyFileRewrites(
    action,
    workspaceRoot,
    dryRun,
    [...rewritesByFile].map(([absolutePath, next]) => ({ absolutePath, next })),
    "O CALLSITES",
  );
}

function organizeImportsAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("ORGANIZE.IMPORTS requires file=<M#|repo-path>")]);
  }
  const service = buildLanguageService(workspaceRoot, snapshot);
  const changes = service.organizeImports(
    { type: "file", fileName: resolved.path.absolutePath },
    {},
    {},
  );
  return applyLanguageServiceChanges(
    action,
    workspaceRoot,
    dryRun,
    new Map(changes.map((change) => [change.fileName, change.textChanges])),
    "O IMPORTS",
  );
}

function formatAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const resolved = resolveActionPath(action, snapshot, workspaceRoot, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("FORMAT requires file=<M#|repo-path>")]);
  }
  const service = buildLanguageService(workspaceRoot, snapshot);
  const changes = service.getFormattingEditsForDocument(resolved.path.absolutePath, {
    indentSize: 2,
    tabSize: 2,
    convertTabsToSpaces: true,
    newLineCharacter: "\n",
  });
  const current = readFileSync(resolved.path.absolutePath, "utf8");
  const languageFormatted = applyTextChangesToContent(current, changes);
  const fallback = languageFormatted
    .replace(/\bexport\s+const\s+/g, "export const ")
    .replace(/\s*=\s*/g, " = ")
    .replace(/^(.+[^;\s])$/gm, (line) =>
      /^\s*(import|export|const|let|var)\b/.test(line) && !/[{};]$/.test(line) ? `${line};` : line,
    );
  return applyFileRewrites(
    action,
    workspaceRoot,
    dryRun,
    fallback === current ? [] : [{ absolutePath: resolved.path.absolutePath, next: fallback }],
    "O FORMAT",
  );
}

function rollbackAction(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const journal = action.args.journal ?? action.args.path;
  if (!journal) {
    return failedStep(action, dryRun, [actionError("ROLLBACK requires journal=<repo-path>")]);
  }
  const resolved = resolveRepoPath(workspaceRoot, journal, true);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve rollback journal")]);
  }
  if (!existsSync(resolved.path.absolutePath)) {
    return failedStep(action, dryRun, [actionError(`journal not found: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }

  let parsed: { changes?: CairFileChange[] };
  try {
    parsed = JSON.parse(readFileSync(resolved.path.absolutePath, "utf8")) as { changes?: CairFileChange[] };
  } catch (error) {
    return failedStep(action, dryRun, [
      actionError(`could not parse journal ${resolved.path.repoPath}: ${error instanceof Error ? error.message : String(error)}`),
    ]);
  }

  const journalChanges = parsed.changes ?? [];
  const rollbackChanges: CairFileChange[] = [];
  for (const change of [...journalChanges].reverse()) {
    const target = resolveRepoPath(workspaceRoot, change.path, true);
    if (target.diagnostic || !target.path) {
      return failedStep(action, dryRun, [target.diagnostic ?? actionError(`failed to resolve rollback target ${change.path}`)]);
    }
    const current = existsSync(target.path.absolutePath)
      ? readFileSync(target.path.absolutePath, "utf8")
      : "";
    if (change.beforeContent !== undefined) {
      maybeWrite(target.path.absolutePath, change.beforeContent, dryRun);
      rollbackChanges.push({
        path: target.path.repoPath,
        operation: "patch",
        beforeHash: hashText(current),
        afterHash: hashText(change.beforeContent),
        bytesBefore: byteLength(current),
        bytesAfter: byteLength(change.beforeContent),
        beforeContent: current,
        afterContent: change.beforeContent,
      });
      continue;
    }
    if (!dryRun && existsSync(target.path.absolutePath)) {
      rmSync(target.path.absolutePath, { force: true });
    }
    rollbackChanges.push({
      path: target.path.repoPath,
      operation: "patch",
      beforeHash: hashText(current),
      afterHash: hashText(""),
      bytesBefore: byteLength(current),
      bytesAfter: 0,
      beforeContent: current,
      afterContent: "",
    });
  }

  return {
    ok: true,
    action,
    dryRun,
    applied: !dryRun,
    observations: [
      observation(
        dryRun ? "O ROLLBACK.PLAN" : "O ROLLBACK.APPLIED",
        `journal=${resolved.path.repoPath} changes=${rollbackChanges.length}${dryRun ? " dryRun=true" : ""}`,
        { changes: rollbackChanges },
      ),
    ],
    diagnostics: [],
    changes: rollbackChanges,
  };
}

function resolvePlanPath(workspaceRoot: string, planRef: string): ResolvedPath | null {
  if (!planRef.startsWith("P#")) {
    const resolved = resolveRepoPath(workspaceRoot, planRef, true);
    return resolved.path ?? null;
  }
  const planDir = join(workspaceRoot, ".forge", "cair", "plans");
  if (!existsSync(planDir)) {
    return null;
  }
  for (const entry of readdirSync(planDir).sort().reverse()) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const absolutePath = join(planDir, entry);
    try {
      const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as { id?: string };
      if (parsed.id === planRef) {
        return {
          repoPath: normalizeSlashes(relative(workspaceRoot, absolutePath)),
          absolutePath,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function applyPlanAction(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const planRef = action.args.plan ?? action.args.path ?? action.args.id;
  if (!planRef) {
    return failedStep(action, dryRun, [actionError("APPLY requires plan=<P#|repo-path>")]);
  }
  const planPath = resolvePlanPath(workspaceRoot, planRef);
  if (!planPath || !existsSync(planPath.absolutePath)) {
    return failedStep(action, dryRun, [actionError(`plan not found: ${planRef}`)]);
  }

  let parsed: { id?: string; changes?: CairFileChange[] };
  try {
    parsed = JSON.parse(readFileSync(planPath.absolutePath, "utf8")) as { id?: string; changes?: CairFileChange[] };
  } catch (error) {
    return failedStep(action, dryRun, [
      actionError(`could not parse plan ${planPath.repoPath}: ${error instanceof Error ? error.message : String(error)}`),
    ]);
  }

  const changes = parsed.changes ?? [];
  const appliedChanges: CairFileChange[] = [];
  for (const change of changes) {
    if (change.afterContent === undefined) {
      continue;
    }
    const target = resolveRepoPath(workspaceRoot, change.path, true);
    if (target.diagnostic || !target.path) {
      return failedStep(action, dryRun, [target.diagnostic ?? actionError(`failed to resolve plan target ${change.path}`)]);
    }
    const current = existsSync(target.path.absolutePath)
      ? readFileSync(target.path.absolutePath, "utf8")
      : "";
    if (change.beforeHash && hashText(current) !== change.beforeHash) {
      return failedStep(action, dryRun, [
        actionError(`plan target changed since plan creation: ${change.path}`, change.path),
      ]);
    }
    maybeWrite(target.path.absolutePath, change.afterContent, dryRun);
    appliedChanges.push({
      path: target.path.repoPath,
      operation: change.operation === "noop" ? "patch" : change.operation,
      beforeHash: hashText(current),
      afterHash: hashText(change.afterContent),
      bytesBefore: byteLength(current),
      bytesAfter: byteLength(change.afterContent),
      beforeContent: current,
      afterContent: change.afterContent,
    });
  }

  return completedStep(action, dryRun, !dryRun && appliedChanges.length > 0, [
    observation(
      dryRun ? "O APPLY.PLAN" : "O APPLY.APPLIED",
      `plan=${parsed.id ?? planPath.repoPath} changes=${appliedChanges.length}${dryRun ? " dryRun=true" : ""}`,
      { plan: { id: parsed.id, path: planPath.repoPath }, changes: appliedChanges },
    ),
  ], appliedChanges, workspaceRoot);
}

function shouldScanFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts)$/.test(path) && !path.includes("/_generated/") && !path.includes("/node_modules/");
}

function listScopeFiles(workspaceRoot: string, scope: string): string[] {
  const resolved = resolveRepoPath(workspaceRoot, scope.replace(/\*\*.*$/, ""), true);
  const root = resolved.path?.absolutePath ?? workspaceRoot;
  const files: string[] = [];
  function visit(path: string): void {
    if (!existsSync(path)) {
      return;
    }
    const stat = statSync(path);
    if (stat.isFile()) {
      const repoPath = normalizeSlashes(relative(workspaceRoot, path));
      if (shouldScanFile(repoPath)) {
        files.push(path);
      }
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }
    const repoPath = normalizeSlashes(relative(workspaceRoot, path));
    if (repoPath.includes("node_modules") || repoPath.includes("_generated")) {
      return;
    }
    for (const entry of readdirSync(path)) {
      visit(join(path, entry));
    }
  }
  visit(root);
  return files.sort();
}

function patternToRegex(pattern: string): RegExp {
  const marker = "__CAIR_MULTI__";
  const escaped = pattern
    .replace(/\$\$\$[A-Z_][A-Z0-9_]*/gi, marker)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll(marker, "([\\s\\S]*?)");
  return new RegExp(escaped, "g");
}

function replacementFromMatch(replacement: string, match: RegExpExecArray): string {
  let index = 1;
  return replacement.replace(/\$\$\$[A-Z_][A-Z0-9_]*/gi, () => match[index++] ?? "");
}

function findPatternAction(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const pattern = action.args.pattern ?? action.body;
  if (!pattern) {
    return failedStep(action, dryRun, [actionError("FIND.PATTERN requires pattern=<code> or body")]);
  }
  const scope = action.args.scope ?? "src";
  const regex = patternToRegex(pattern);
  const matches: Array<{ file: string; start: number; end: number; text: string }> = [];
  for (const file of listScopeFiles(workspaceRoot, scope)) {
    const text = readFileSync(file, "utf8");
    regex.lastIndex = 0;
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      matches.push({
        file: normalizeSlashes(relative(workspaceRoot, file)),
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
  return {
    ok: true,
    action,
    dryRun,
    applied: false,
    observations: [
      observation("O PATTERN.MATCHES", `matches=${matches.length} scope=${scope}`, { matches }),
    ],
    diagnostics: [],
    changes: [],
  };
}

function rewritePatternAction(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const pattern = action.args.pattern;
  const replacement = action.args.replacement ?? action.body;
  if (!pattern || replacement === undefined) {
    return failedStep(action, dryRun, [actionError("REWRITE.PATTERN requires pattern=<code> and replacement=<code> or body")]);
  }
  const scope = action.args.scope ?? "src";
  const regex = patternToRegex(pattern);
  const rewrites: Array<{ absolutePath: string; next: string }> = [];
  for (const file of listScopeFiles(workspaceRoot, scope)) {
    const text = readFileSync(file, "utf8");
    regex.lastIndex = 0;
    let changed = false;
    const next = text.replace(regex, (...parts: unknown[]) => {
      const match = parts[0] as string;
      const captures = parts.slice(1, -2) as string[];
      const exec = [match, ...captures] as unknown as RegExpExecArray;
      changed = true;
      return replacementFromMatch(replacement, exec);
    });
    if (changed && next !== text) {
      rewrites.push({ absolutePath: file, next });
    }
  }
  return applyFileRewrites(action, workspaceRoot, dryRun, rewrites, "O PATTERN.REWRITE");
}

function makePrimitiveFromVerb(verb: CairParsedAction["verb"]): MakePrimitive {
  switch (verb) {
    case "MAKE.COMMAND":
      return "command";
    case "MAKE.QUERY":
      return "query";
    case "MAKE.ACTION":
      return "action";
    case "MAKE.TABLE":
      return "table";
    default:
      return "command";
  }
}

function makeAction(
  action: CairParsedAction,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const name = action.args.name;
  if (!name) {
    return failedStep(action, dryRun, [actionError(`${action.verb} requires name=<name>`)]);
  }
  const options: MakeCommandOptions = {
    primitive: makePrimitiveFromVerb(action.verb),
    name,
    workspaceRoot,
    json: true,
    dryRun,
    plan: action.args.plan === "true",
    apply: !dryRun,
    yes: true,
    force: action.args.force === "true",
    noGenerate: action.args["no-generate"] === "true",
    noVerify: action.args["no-verify"] === "true",
    keepFailed: false,
    tenantScoped: action.args.tenantscoped === "true" || action.args["tenant-scoped"] === "true",
    fieldSpecs: action.args.field ? [action.args.field] : [],
    fieldsRaw: action.args.fields,
    type: action.args.type,
    values: action.args.values,
    defaultValue: action.args.default,
    index: action.args.index === "true",
    roles: action.args.roles,
    table: action.args.table,
    policy: action.args.policy,
    emit: action.args.emit,
    event: action.args.event,
    trigger: action.args.trigger,
    component: action.args.component,
    framework: action.args.framework as "vite" | "next" | "nuxt" | undefined,
    withAi: action.args.withai === "true" || action.args["with-ai"] === "true",
    withCrud: action.args.withcrud === "true" || action.args["with-crud"] === "true",
    withLiveQuery: action.args.withlivequery === "true" || action.args["with-livequery"] === "true",
    withReact: action.args.withreact === "true" || action.args["with-react"] === "true",
    withUi: action.args.withui === "true" || action.args["with-ui"] === "true",
    withTests: action.args.withtests === "true" || action.args["with-tests"] === "true",
    withCreateForm: action.args.withcreateform === "true" || action.args["with-create-form"] === "true",
  };
  const result = planMakeCommand(options);
  const plannedFiles = [
    ...(result.plan?.filesToCreate.map((file) => file.file) ?? []),
    ...(result.plan?.filesToModify.map((file) => file.file) ?? []),
  ];
  return {
    ok: result.ok,
    action,
    dryRun,
    applied: result.applied === true,
    observations: [
      observation(
        result.applied ? "O MAKE.APPLIED" : "O MAKE.PLAN",
        `primitive=${options.primitive} name=${name} files=${plannedFiles.length}${dryRun ? " dryRun=true" : ""}`,
        { make: result, files: plannedFiles },
      ),
    ],
    diagnostics: result.diagnostics,
    changes: plannedFiles.map((file) => ({
      path: file,
      operation: result.applied ? "patch" : "noop",
    })),
  };
}

function importSpecifier(fromFile: string, toFile: string): string {
  const withoutExtension = toFile.replace(/\.(tsx?|jsx?|mts|cts)$/u, "");
  const specifier = normalizeSlashes(relative(dirname(fromFile), withoutExtension));
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function kebabName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "symbol";
}

function addTestAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("ADD.TEST requires target=<S#>")]);
  }
  const kind = action.args.kind ?? "unit";
  const testPath = action.args.path ?? `tests/${symbol.kind.replace(/[^\w.-]+/g, "-")}/${kebabName(symbol.name)}.test.ts`;
  const resolved = resolveRepoPath(workspaceRoot, testPath, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve ADD.TEST path")]);
  }
  const body = action.body ?? [
    'import { describe, expect, test } from "bun:test";',
    `import { ${symbol.name} } from "${importSpecifier(resolved.path.repoPath, symbol.file)}";`,
    "",
    `describe("${symbol.name}", () => {`,
    `  test("${kind}", () => {`,
    `    expect(${symbol.name}).toBeDefined();`,
    "  });",
    "});",
    "",
  ].join("\n");
  const current = existsSync(resolved.path.absolutePath)
    ? readFileSync(resolved.path.absolutePath, "utf8")
    : "";
  if (current && action.args.force !== "true") {
    return failedStep(action, dryRun, [actionError(`test already exists: ${resolved.path.repoPath}`, resolved.path.repoPath)]);
  }
  return applyFileRewrites(action, workspaceRoot, dryRun, [
    { absolutePath: resolved.path.absolutePath, next: body },
  ], "O TEST");
}

function wireExportAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  const symbol = resolveSymbolRef(snapshot, action.args.target);
  if (!symbol) {
    return failedStep(action, dryRun, [actionError("WIRE.EXPORT requires target=<S#>")]);
  }
  const barrelPath = action.args.file ?? action.args.path ?? "src/index.ts";
  const resolved = resolveRepoPath(workspaceRoot, barrelPath, allowGenerated);
  if (resolved.diagnostic || !resolved.path) {
    return failedStep(action, dryRun, [resolved.diagnostic ?? actionError("failed to resolve WIRE.EXPORT path")]);
  }
  const current = existsSync(resolved.path.absolutePath)
    ? readFileSync(resolved.path.absolutePath, "utf8")
    : "";
  const line = `export { ${symbol.name} } from "${importSpecifier(resolved.path.repoPath, symbol.file)}";`;
  const next = current.includes(line)
    ? current
    : `${current}${current.endsWith("\n") || !current ? "" : "\n"}${line}\n`;
  return applyFileRewrites(action, workspaceRoot, dryRun, [
    { absolutePath: resolved.path.absolutePath, next },
  ], "O EXPORT");
}

function verifyAction(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
): CairActionStepResult {
  const kind = action.phase === "V"
    ? action.raw.trim().split(/\s+/)[1]?.toLowerCase()
    : (action.args.kind ?? action.args.check ?? "typecheck").toLowerCase();
  if (kind === "impact") {
    const symbol = resolveSymbolRef(snapshot, action.args.target);
    const tests = symbol
      ? snapshot.lexicon.tests.filter((test) =>
        Object.values(test.covers).some((covered) =>
          covered.includes(symbol.name) ||
          covered.includes(symbol.qualifiedName) ||
          covered.includes(symbol.sourceId) ||
          covered.includes(symbol.file),
        ),
      )
      : [];
    return {
      ok: true,
      action,
      dryRun,
      applied: false,
      observations: [
        observation(
          "O VERIFY.IMPACT",
          `target=${action.args.target ?? "none"} tests=${tests.map((test) => test.id).join(",") || "none"} matches=${tests.length}`,
          { symbol, tests },
        ),
      ],
      diagnostics: [],
      changes: [],
    };
  }
  if (dryRun) {
    return completedStep(action, dryRun, false, [
      observation("O VERIFY.PLAN", `kind=${kind || "typecheck"} dryRun=true`),
    ], [], workspaceRoot);
  }

  if (kind === "typecheck" || kind === "tsc") {
    const tscPath = join(workspaceRoot, "node_modules", "typescript", "bin", "tsc");
    if (!existsSync(tscPath)) {
      return failedStep(action, dryRun, [actionError("VERIFY typecheck requires node_modules/typescript/bin/tsc")]);
    }
    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [tscPath, "--noEmit"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });
    const elapsedMs = Date.now() - startedAt;
    const ok = result.status === 0;
    return {
      ok,
      action,
      dryRun,
      applied: false,
      observations: [
        observation(
          "O VERIFY.TYPECHECK",
          `ok=${ok} exit=${result.status ?? "null"} ms=${elapsedMs}`,
          {
            stdout: result.stdout,
            stderr: result.stderr,
          },
        ),
      ],
      diagnostics: ok ? [] : [actionError(`typecheck failed with exit ${result.status ?? "null"}`)],
      changes: [],
    };
  }

  if (kind === "test") {
    const file = action.args.file;
    const runner = join(workspaceRoot, "bin", "forge-bun.mjs");
    if (!existsSync(runner)) {
      return failedStep(action, dryRun, [actionError("VERIFY test requires bin/forge-bun.mjs")]);
    }
    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      [runner, "test", ...(file ? [file] : []), "--timeout", action.args.timeout ?? "120000"],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        timeout: Number(action.args.timeout ?? 120_000),
        windowsHide: true,
      },
    );
    const elapsedMs = Date.now() - startedAt;
    const ok = result.status === 0;
    return {
      ok,
      action,
      dryRun,
      applied: false,
      observations: [
        observation(
          "O VERIFY.TEST",
          `ok=${ok} exit=${result.status ?? "null"} ms=${elapsedMs}${file ? ` file=${file}` : ""}`,
          {
            stdout: result.stdout,
            stderr: result.stderr,
          },
        ),
      ],
      diagnostics: ok ? [] : [actionError(`test failed with exit ${result.status ?? "null"}`)],
      changes: [],
    };
  }

  return failedStep(action, dryRun, [actionError(`unknown VERIFY kind '${kind}'`)]);
}

function failedStep(
  action: CairParsedAction,
  dryRun: boolean,
  diagnostics: Diagnostic[],
): CairActionStepResult {
  return {
    ok: false,
    action,
    dryRun,
    applied: false,
    observations: diagnostics.map((diagnostic) =>
      observation("O ACTION.FAIL", `code=${diagnostic.code} message=${JSON.stringify(diagnostic.message)}`),
    ),
    diagnostics,
    changes: [],
  };
}

function completedStep(
  action: CairParsedAction,
  dryRun: boolean,
  applied: boolean,
  observations: CairObservation[],
  changes: CairFileChange[],
  workspaceRoot: string,
): CairActionStepResult {
  const journalPath = writeCairActionJournal(workspaceRoot, action, changes, dryRun);
  const planRef = dryRun ? writeCairActionPlan(workspaceRoot, action, changes) : undefined;
  const planObservations = changes.length > 0
    ? [
      observation(
        "O ACTION.PLAN",
        [
          `verb=${action.verb}`,
          `changes=${changes.length}`,
          `files=${changes.map((change) => change.path).join(",") || "none"}`,
          dryRun ? "dryRun=true" : null,
        ].filter(Boolean).join(" "),
        { changes },
      ),
    ]
    : [];
  const planObservationsWithRef = planRef
    ? [...planObservations, observation("O PLAN", `id=${planRef.id} path=${planRef.path}`, { plan: planRef })]
    : planObservations;
  return {
    ok: true,
    action,
    dryRun,
    applied,
    observations: journalPath
      ? [...planObservationsWithRef, ...observations, observation("O JOURNAL", `path=${journalPath}`)]
      : [...planObservationsWithRef, ...observations],
    diagnostics: [],
    changes,
    ...(journalPath ? { journalPath } : {}),
    ...(planRef ? { planPath: planRef.path, planId: planRef.id } : {}),
  };
}

function runCairActionStep(
  action: CairParsedAction,
  snapshot: CairSnapshot,
  workspaceRoot: string,
  dryRun: boolean,
  allowGenerated: boolean,
): CairActionStepResult {
  switch (action.verb) {
    case "CREATE.FILE":
      return createFileAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "CREATE.SYMBOL":
      return createSymbolAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "PATCH":
      return patchAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "ADD.IMPORT":
      return addImportAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "ADD.EXPORT":
      return addExportAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "APPLY":
      return applyPlanAction(action, workspaceRoot, dryRun);
    case "ROLLBACK":
      return rollbackAction(action, workspaceRoot, dryRun);
    case "RENAME.SYMBOL":
      return renameSymbolAction(action, snapshot, workspaceRoot, dryRun);
    case "MOVE.SYMBOL":
      return moveSymbolAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "UPDATE.SIGNATURE":
      return updateSignatureAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "ADD.PARAM":
      return addParamAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "UPDATE.CALLSITES":
      return updateCallsitesAction(action, snapshot, workspaceRoot, dryRun);
    case "ORGANIZE.IMPORTS":
      return organizeImportsAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "FORMAT":
      return formatAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "FIND.PATTERN":
      return findPatternAction(action, workspaceRoot, dryRun);
    case "REWRITE.PATTERN":
      return rewritePatternAction(action, workspaceRoot, dryRun);
    case "MAKE.COMMAND":
    case "MAKE.QUERY":
    case "MAKE.ACTION":
    case "MAKE.TABLE":
      return makeAction(action, workspaceRoot, dryRun);
    case "ADD.TEST":
      return addTestAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "WIRE.EXPORT":
      return wireExportAction(action, snapshot, workspaceRoot, dryRun, allowGenerated);
    case "VERIFY":
      return verifyAction(action, snapshot, workspaceRoot, dryRun);
  }
}

export function runCairActionScript(options: CairActionRunOptions): CairActionResult {
  const parsedScript = parseCairActionScript(options.script);
  const blocks = parsedScript.blocks;
  const scriptDiagnostics = [...parsedScript.diagnostics];
  if (parsedScript.header?.snapshot && parsedScript.header.snapshot !== options.snapshot.snapshotId) {
    scriptDiagnostics.push(actionError(
      `CAIR snapshot mismatch: script=${parsedScript.header.snapshot} current=${options.snapshot.snapshotId}`,
    ));
  }
  if (blocks.length === 0) {
    const diagnostics = scriptDiagnostics.length > 0 ? scriptDiagnostics : [actionError("empty CAIR action script")];
    return {
      ok: false,
      dryRun: options.dryRun,
      plan: options.plan,
      ...(parsedScript.header ? { header: parsedScript.header } : {}),
      actionCount: 0,
      steps: [],
      observations: diagnostics.map((diagnostic) =>
        observation("O ACTION.FAIL", `code=${diagnostic.code} message=${JSON.stringify(diagnostic.message)}`),
      ),
      diagnostics,
      journalPaths: [],
      planPaths: [],
    };
  }

  const steps: CairActionStepResult[] = [];
  const parseDiagnostics: Diagnostic[] = [...scriptDiagnostics];
  for (const block of blocks) {
    if (parseDiagnostics.length > 0) {
      break;
    }
    const parsed = parseCairAction(block);
    if (parsed.diagnostics.length > 0 || !parsed.action) {
      parseDiagnostics.push(...parsed.diagnostics);
      continue;
    }
    steps.push(
      runCairActionStep(
        parsed.action,
        options.snapshot,
        options.workspaceRoot,
        options.dryRun,
        options.allowGenerated,
      ),
    );
    if (!steps[steps.length - 1]?.ok) {
      break;
    }
  }

  const diagnostics = [...parseDiagnostics, ...steps.flatMap((step) => step.diagnostics)];
  const observations = [
    ...parseDiagnostics.map((diagnostic) =>
      observation("O ACTION.FAIL", `code=${diagnostic.code} message=${JSON.stringify(diagnostic.message)}`),
    ),
    ...steps.flatMap((step) => step.observations),
  ];
  const journalPaths = steps.flatMap((step) => step.journalPath ? [step.journalPath] : []);
  const planPaths = steps.flatMap((step) => step.planPath ? [step.planPath] : []);
  return {
    ok: diagnostics.length === 0 && steps.every((step) => step.ok),
    dryRun: options.dryRun,
    plan: options.plan,
    ...(parsedScript.header ? { header: parsedScript.header } : {}),
    actionCount: blocks.length,
    steps,
    observations,
    diagnostics,
    journalPaths,
    planPaths,
  };
}

export function statActionInput(workspaceRoot: string, inputPath: string): string {
  const resolved = resolveRepoPath(workspaceRoot, inputPath, true);
  if (resolved.diagnostic || !resolved.path) {
    throw new Error(resolved.diagnostic?.message ?? "invalid CAIR input path");
  }
  if (!existsSync(resolved.path.absolutePath) || !statSync(resolved.path.absolutePath).isFile()) {
    throw new Error(`CAIR input file not found: ${resolved.path.repoPath}`);
  }
  return readFileSync(resolved.path.absolutePath, "utf8");
}
