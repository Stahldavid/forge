import ts from "typescript";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PlannedFile, PlannedPatch } from "../make/types.ts";
import type { RefactorIntent } from "./types.ts";
import { isGenerated, makeFile, makePatchFromContent, patchFile, readText, walkFiles } from "./workspace-fs.ts";

export type RenameRuntimeEntryIntent = Extract<RefactorIntent, { kind: "renameRuntimeEntry" }>;

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
): Diagnostic {
  return createDiagnostic({
    severity,
    code,
    message,
    ...(file ? { file } : {}),
  });
}

function runtimeCollectionProperty(entryKind: RenameRuntimeEntryIntent["entryKind"]): string {
  return {
    command: "commands",
    query: "queries",
    liveQuery: "liveQueries",
    action: "actions",
    workflow: "workflows",
  }[entryKind];
}

function runtimeEntryDirectories(entryKind: RenameRuntimeEntryIntent["entryKind"]): string[] {
  return {
    command: ["src/commands"],
    query: ["src/queries"],
    liveQuery: ["src/queries"],
    action: ["src/actions"],
    workflow: ["src/workflows"],
  }[entryKind];
}

function runtimeEntryCallName(entryKind: RenameRuntimeEntryIntent["entryKind"]): string {
  return {
    command: "command",
    query: "query",
    liveQuery: "liveQuery",
    action: "action",
    workflow: "workflow",
  }[entryKind];
}

function runtimeHttpSegment(entryKind: RenameRuntimeEntryIntent["entryKind"]): string | null {
  return {
    command: "commands",
    query: "queries",
    liveQuery: "live",
    action: null,
    workflow: null,
  }[entryKind];
}

function isTypeScriptLike(file: string): boolean {
  return file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".jsx");
}

function scriptKindForFile(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function renameIdentifierNode(to: string): ts.Identifier {
  return ts.factory.createIdentifier(to);
}

function isRuntimeEntryCall(node: ts.Expression | undefined, entryKind: RenameRuntimeEntryIntent["entryKind"]): boolean {
  if (!node || !ts.isCallExpression(node)) {
    return false;
  }
  const expected = runtimeEntryCallName(entryKind);
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === expected) ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === expected)
  );
}

function isCapabilityMapRuntimeAccess(
  node: ts.PropertyAccessExpression,
  from: string,
  entryKind: RenameRuntimeEntryIntent["entryKind"],
  sourceFile: ts.SourceFile,
): boolean {
  if (node.name.text !== from) {
    return false;
  }
  const collection = runtimeCollectionProperty(entryKind);
  const parent = node.expression;
  if (ts.isIdentifier(parent)) {
    return parent.text === collection && hasForgeBridgeImport(sourceFile, collection);
  }
  if (!ts.isPropertyAccessExpression(parent)) {
    return false;
  }
  if (parent.name.text !== collection) {
    return false;
  }
  const root = parent.expression;
  return (
    ts.isIdentifier(root) &&
    hasForgeBridgeImport(sourceFile, root.text) &&
    (root.text === "api" ||
      root.text === "client" ||
      root.text === "commands" ||
      root.text === "queries" ||
      root.text === "liveQueries")
  );
}

function importLooksLikeForgeBridge(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, "/");
  return (
    normalized.includes("/_generated/") ||
    normalized.endsWith("/_generated/api") ||
    normalized.endsWith("/_generated/api.js") ||
    normalized.endsWith("/_generated/api.ts") ||
    normalized.endsWith("/lib/forge") ||
    normalized.endsWith("/lib/forge.js") ||
    normalized.endsWith("/lib/forge.ts") ||
    normalized.endsWith("/lib/forge.tsx") ||
    normalized === "forge/client" ||
    normalized === "forge/react"
  );
}

function hasForgeBridgeImport(sourceFile: ts.SourceFile, name: string): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (!importLooksLikeForgeBridge(statement.moduleSpecifier.text)) {
      continue;
    }
    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }
    if (importClause.name?.text === name) {
      return true;
    }
    const namedBindings = importClause.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
      continue;
    }
    if (namedBindings.elements.some((element) => element.name.text === name)) {
      return true;
    }
  }
  return false;
}

function hookKindForCall(node: ts.CallExpression): RenameRuntimeEntryIntent["entryKind"] | null {
  if (!ts.isIdentifier(node.expression)) {
    return null;
  }
  const map: Record<string, RenameRuntimeEntryIntent["entryKind"]> = {
    useCommand: "command",
    useQuery: "query",
    useLiveQuery: "liveQuery",
  };
  return map[node.expression.text] ?? null;
}

function clientMethodForEntry(entryKind: RenameRuntimeEntryIntent["entryKind"]): string | null {
  return {
    command: "command",
    query: "query",
    liveQuery: "liveQuery",
    action: null,
    workflow: null,
  }[entryKind];
}

function isRuntimeStringLiteralContext(
  node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
  intent: RenameRuntimeEntryIntent,
): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent)) {
    const hookKind = hookKindForCall(parent);
    if (hookKind === intent.entryKind && parent.arguments[0] === node) {
      return true;
    }
    const clientMethod = clientMethodForEntry(intent.entryKind);
    if (
      clientMethod &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === clientMethod &&
      parent.arguments[0] === node
    ) {
      return true;
    }
  }
  const segment = runtimeHttpSegment(intent.entryKind);
  if (segment && runtimeHttpPathReferences(node.text, segment, intent.from)) {
    return true;
  }
  return false;
}

function renameImportSpecifierPath(specifier: string, from: string, to: string): string {
  const slashIndex = specifier.lastIndexOf("/");
  if (slashIndex === -1) {
    return specifier;
  }
  const prefix = specifier.slice(0, slashIndex + 1);
  const leaf = specifier.slice(slashIndex + 1);
  for (const ext of ["", ".js", ".jsx", ".ts", ".tsx"]) {
    if (leaf === `${from}${ext}`) {
      return `${prefix}${to}${ext}`;
    }
  }
  return specifier;
}

function importSpecifierReferencesRuntimeEntry(specifier: string, from: string, to = from): boolean {
  return renameImportSpecifierPath(specifier, from, to) !== specifier;
}

function runtimeHttpPathReferences(value: string, segment: string, name: string): boolean {
  const marker = `/${segment}/${name}`;
  const index = value.indexOf(marker);
  if (index === -1) {
    return false;
  }
  const next = value[index + marker.length];
  return next === undefined || next === "/" || next === "?" || next === "#" || next === "&";
}

function renameRuntimeHttpPath(value: string, segment: string, from: string, to: string): string {
  const marker = `/${segment}/${from}`;
  if (!runtimeHttpPathReferences(value, segment, from)) {
    return value;
  }
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const index = value.indexOf(marker, cursor);
    if (index === -1) {
      output += value.slice(cursor);
      break;
    }
    const next = value[index + marker.length];
    if (next === undefined || next === "/" || next === "?" || next === "#" || next === "&") {
      output += value.slice(cursor, index) + `/${segment}/${to}`;
      cursor = index + marker.length;
      continue;
    }
    output += value.slice(cursor, index + marker.length);
    cursor = index + marker.length;
  }
  return output;
}

export function findRuntimeEntryFile(
  workspaceRoot: string,
  entryKind: RenameRuntimeEntryIntent["entryKind"],
  name: string,
): string | null {
  for (const dir of runtimeEntryDirectories(entryKind)) {
    for (const ext of [".ts", ".tsx"]) {
      const candidate = `${dir}/${name}${ext}`;
      if (readText(workspaceRoot, candidate)) {
        return candidate;
      }
    }
  }
  for (const file of walkFiles(workspaceRoot)) {
    if (!runtimeEntryDirectories(entryKind).some((dir) => file.startsWith(`${dir}/`))) {
      continue;
    }
    const content = readText(workspaceRoot, file) ?? "";
    if (content.includes(`export const ${name}`)) {
      return file;
    }
  }
  return null;
}

export function sourceReferencesRuntimeEntry(source: string, file: string, intent: RenameRuntimeEntryIntent): boolean {
  if (file.endsWith(`/${intent.from}.ts`) || file.endsWith(`/${intent.from}.tsx`)) {
    return true;
  }
  if (!source.includes(intent.from)) {
    return false;
  }
  if (isTypeScriptLike(file)) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) {
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === intent.from &&
        isRuntimeEntryCall(node.initializer, intent.entryKind)
      ) {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(node) && isCapabilityMapRuntimeAccess(node, intent.from, intent.entryKind, sourceFile)) {
        found = true;
        return;
      }
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        node.text === intent.from &&
        isRuntimeStringLiteralContext(node, intent)
      ) {
        found = true;
        return;
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (importSpecifierReferencesRuntimeEntry(node.moduleSpecifier.text, intent.from)) {
          found = true;
          return;
        }
      }
      const segment = runtimeHttpSegment(intent.entryKind);
      if (
        segment &&
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        runtimeHttpPathReferences(node.text, segment, intent.from)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }
  if (file.endsWith(".json")) {
    try {
      return jsonReferencesRuntimeEntry(JSON.parse(source) as unknown, intent.from, intent.entryKind);
    } catch {
      return false;
    }
  }
  return false;
}

function jsonReferencesRuntimeEntry(value: unknown, name: string, entryKind: RenameRuntimeEntryIntent["entryKind"]): boolean {
  return jsonReferencesRuntimeEntryAtKey(value, name, entryKind, undefined);
}

function runtimeJsonKeys(entryKind: RenameRuntimeEntryIntent["entryKind"]): Set<string> {
  return new Set([
    runtimeEntryCallName(entryKind),
    runtimeCollectionProperty(entryKind),
    entryKind,
  ]);
}

function jsonReferencesRuntimeEntryAtKey(
  value: unknown,
  name: string,
  entryKind: RenameRuntimeEntryIntent["entryKind"],
  key: string | undefined,
): boolean {
  const allowedKeys = runtimeJsonKeys(entryKind);
  if (typeof value === "string") {
    return value === name && !!key && allowedKeys.has(key);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => jsonReferencesRuntimeEntryAtKey(entry, name, entryKind, key));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === entryKind && record.name === name) {
      return true;
    }
    return Object.entries(record).some(([childKey, entry]) =>
      jsonReferencesRuntimeEntryAtKey(entry, name, entryKind, childKey),
    );
  }
  return false;
}

function renameRuntimeEntryInJson(source: string, intent: RenameRuntimeEntryIntent): string {
  const parsed = JSON.parse(source) as unknown;
  return `${JSON.stringify(renameRuntimeEntryJsonValue(parsed, intent), null, 2)}\n`;
}

function renameRuntimeEntryJsonValue(value: unknown, intent: RenameRuntimeEntryIntent): unknown {
  return renameRuntimeEntryJsonValueAtKey(value, intent, undefined);
}

function renameRuntimeEntryJsonValueAtKey(
  value: unknown,
  intent: RenameRuntimeEntryIntent,
  key: string | undefined,
): unknown {
  const allowedKeys = runtimeJsonKeys(intent.entryKind);
  if (typeof value === "string") {
    return value === intent.from && !!key && allowedKeys.has(key) ? intent.to : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renameRuntimeEntryJsonValueAtKey(entry, intent, key));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [childKey, entry] of Object.entries(record)) {
      output[childKey] =
        childKey === "name" && record.kind === intent.entryKind && entry === intent.from
          ? intent.to
          : renameRuntimeEntryJsonValueAtKey(entry, intent, childKey);
    }
    return output;
  }
  return value;
}

export function renameRuntimeEntryContent(source: string, file: string, intent: RenameRuntimeEntryIntent): string {
  if (isTypeScriptLike(file)) {
    return renameRuntimeEntryInSource(source, file, intent);
  }
  if (file.endsWith(".json")) {
    return renameRuntimeEntryInJson(source, intent);
  }
  return source;
}

function renameRuntimeEntryInSource(source: string, file: string, intent: RenameRuntimeEntryIntent): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === intent.from &&
        isRuntimeEntryCall(node.initializer, intent.entryKind)
      ) {
        return ts.factory.updateVariableDeclaration(
          node,
          renameIdentifierNode(intent.to),
          node.exclamationToken,
          node.type,
          ts.visitNode(node.initializer, visit, ts.isExpression) ?? node.initializer,
        );
      }
      if (ts.isPropertyAccessExpression(node) && isCapabilityMapRuntimeAccess(node, intent.from, intent.entryKind, sourceFile)) {
        return ts.factory.updatePropertyAccessExpression(node, node.expression, renameIdentifierNode(intent.to));
      }
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        node.text === intent.from &&
        isRuntimeStringLiteralContext(node, intent)
      ) {
        return ts.isNoSubstitutionTemplateLiteral(node)
          ? ts.factory.createNoSubstitutionTemplateLiteral(intent.to)
          : ts.factory.createStringLiteral(intent.to);
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const segment = runtimeHttpSegment(intent.entryKind);
        if (segment) {
          const nextPath = renameRuntimeHttpPath(node.text, segment, intent.from, intent.to);
          if (nextPath !== node.text) {
            return ts.isNoSubstitutionTemplateLiteral(node)
              ? ts.factory.createNoSubstitutionTemplateLiteral(nextPath)
              : ts.factory.createStringLiteral(nextPath);
          }
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const nextSpecifier = renameImportSpecifierPath(node.moduleSpecifier.text, intent.from, intent.to);
        if (nextSpecifier !== node.moduleSpecifier.text) {
          return ts.factory.updateImportDeclaration(
            node,
            node.modifiers,
            node.importClause,
            ts.factory.createStringLiteral(nextSpecifier),
            node.attributes,
          );
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };
  const result = ts.transform(sourceFile, [transform]);
  try {
    const transformed = result.transformed[0];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    return printer.printFile(transformed);
  } finally {
    result.dispose();
  }
}

export function buildRenameRuntimeEntryPlan(
  workspaceRoot: string,
  intent: RenameRuntimeEntryIntent,
): {
  patches: PlannedPatch[];
  filesToCreate: PlannedFile[];
  filesToDelete: Array<{ file: string; description: string }>;
  diagnostics: Diagnostic[];
} {
  const patches: PlannedPatch[] = [];
  const filesToCreate: PlannedFile[] = [];
  const filesToDelete: Array<{ file: string; description: string }> = [];
  const diagnostics: Diagnostic[] = [];
  const definitionFile = findRuntimeEntryFile(workspaceRoot, intent.entryKind, intent.from);
  if (!definitionFile) {
    return {
      patches,
      filesToCreate,
      filesToDelete,
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_REFACTOR_TARGET_NOT_FOUND",
          `${intent.entryKind} '${intent.from}' was not found`,
        ),
      ],
    };
  }

  let found = false;
  for (const file of walkFiles(workspaceRoot)) {
    if (isGenerated(file)) {
      continue;
    }
    const content = readText(workspaceRoot, file) ?? "";
    if (!sourceReferencesRuntimeEntry(content, file, intent)) {
      continue;
    }
    if (file === definitionFile) {
      const shouldRenameFile = file.endsWith(`/${intent.from}.ts`) || file.endsWith(`/${intent.from}.tsx`);
      const renamedContent = renameRuntimeEntryContent(content, file, intent);
      if (shouldRenameFile) {
        const renamedPath = file.replace(`/${intent.from}.`, `/${intent.to}.`);
        filesToCreate.push(
          makeFile(
            workspaceRoot,
            renamedPath,
            `Rename ${intent.entryKind} file ${intent.from} to ${intent.to}`,
            renamedContent,
          ),
        );
        filesToDelete.push({
          file,
          description: `Remove old ${intent.entryKind} file ${intent.from}`,
        });
      } else {
        const patch = makePatchFromContent(
          file,
          `Rename ${intent.entryKind} ${intent.from} to ${intent.to}`,
          content,
          renamedContent,
        );
        if (patch) {
          patches.push(patch);
        }
      }
      found = true;
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      `Rename ${intent.entryKind} ${intent.from} to ${intent.to}`,
      (source) => renameRuntimeEntryContent(source, file, intent),
    );
    if (patch) {
      found = true;
      patches.push(patch);
    }
  }

  if (!found) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_REFACTOR_TARGET_NOT_FOUND",
        `${intent.entryKind} '${intent.from}' was not found in editable sources`,
      ),
    );
  }

  return { patches, filesToCreate, filesToDelete, diagnostics };
}
