import { join } from "node:path";
import ts from "typescript";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson, serializeCanonical } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PlannedFile, PlannedPatch } from "../make/types.ts";
import type {
  RefactorCommandOptions,
  RefactorImpact,
  RefactorIntent,
  RefactorPlan,
  RefactorRecord,
  RefactorResult,
} from "./types.ts";
import {
  isGenerated,
  makeFile,
  makePatchFromContent,
  patchFile,
  readDirEntries,
  readText,
  removeFile,
  walkFiles,
  writeText,
} from "./workspace-fs.ts";
import {
  parseTableField,
  pushUnique,
  wordReplace,
} from "./text-utils.ts";

const REFACTOR_DIR = ".forge/refactors";

interface SnapshotFile {
  file: string;
  existed: boolean;
  content?: string;
}

interface RefactorSnapshot {
  schemaVersion: "0.1.0";
  id: string;
  files: SnapshotFile[];
}

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

function emptyImpact(): RefactorImpact {
  return {
    data: { tables: [], fields: [], refs: [], indexes: [], rlsPolicies: [] },
    runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [], endpoints: [] },
    frontend: { components: [], pages: [], hooks: [] },
    policies: [],
    tests: [],
    blueprints: [],
    generatedArtifacts: [
      "src/forge/_generated/appGraph.json",
      "src/forge/_generated/dataGraph.json",
      "src/forge/_generated/api.json",
      "src/forge/_generated/agentContract.json",
    ],
  };
}

function inferIntent(options: RefactorCommandOptions): {
  intent?: RefactorIntent;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  if (options.action === "rename") {
    if (options.renameTarget === "field") {
      const from = parseTableField(options.from);
      const to = parseTableField(options.to);
      if (!from || !to || from.table !== to.table) {
        diagnostics.push(
          diagnostic(
            "error",
            "FORGE_REFACTOR_TARGET_NOT_FOUND",
            "rename field requires <table.field> <sameTable.field>",
          ),
        );
        return { diagnostics };
      }
      return {
        diagnostics,
        intent: {
          kind: "renameField",
          table: from.table,
          from: { field: from.field },
          to: { field: to.field },
          updateBlueprints: true,
          updateFrontend: true,
          updateTests: true,
        },
      };
    }
    if (options.renameTarget === "table") {
      if (!options.from || !options.to) {
        diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "rename table requires <from> <to>"));
        return { diagnostics };
      }
      return {
        diagnostics,
        intent: {
          kind: "renameTable",
          from: { table: options.from },
          to: { table: options.to },
          updateFrontend: true,
          updatePolicies: true,
          updateRefs: true,
          updateRuntimeEntries: true,
        },
      };
    }
    if (options.renameTarget === "policy") {
      if (!options.from || !options.to) {
        diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "rename policy requires <from> <to>"));
        return { diagnostics };
      }
      return { diagnostics, intent: { kind: "renamePolicy", from: options.from, to: options.to } };
    }
    if (options.renameTarget === "event") {
      if (!options.from || !options.to) {
        diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "rename event requires <from> <to>"));
        return { diagnostics };
      }
      return { diagnostics, intent: { kind: "renameEvent", from: options.from, to: options.to } };
    }
    const runtimeMap = {
      command: "command",
      query: "query",
      livequery: "liveQuery",
      action: "action",
      workflow: "workflow",
    } as const;
    const entryKind = options.renameTarget ? runtimeMap[options.renameTarget as keyof typeof runtimeMap] : undefined;
    if (entryKind) {
      if (!options.from || !options.to) {
        diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `rename ${options.renameTarget} requires <from> <to>`));
        return { diagnostics };
      }
      return {
        diagnostics,
        intent: {
          kind: "renameRuntimeEntry",
          entryKind,
          from: options.from,
          to: options.to,
          updateApi: true,
          updateClient: true,
          updateFrontend: true,
          updateTests: true,
        },
      };
    }
  }
  if (options.action === "move" && options.renameTarget === "field") {
    diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "unsupported move target"));
  }
  if (options.action === "move" && options.componentName && options.to) {
    return {
      diagnostics,
      intent: { kind: "moveComponent", name: options.componentName, toPath: options.to },
    };
  }
  if (options.action === "extract-action") {
    if (!options.from || !options.packageName) {
      diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "extract-action requires command and --package"));
      return { diagnostics };
    }
    const eventName = options.eventName ?? `${options.from}.requested`;
    return {
      diagnostics,
      intent: {
        kind: "extractAction",
        command: options.from,
        packageName: options.packageName,
        eventName,
        actionName: options.actionName ?? `${options.from}Action`,
        createAction: true,
        createEventPayload: true,
        removeForbiddenImport: true,
      },
    };
  }
  if (options.action === "replace-process-env") {
    if (!options.from) {
      diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "replace-process-env requires an env var"));
      return { diagnostics };
    }
    return {
      diagnostics,
      intent: { kind: "replaceProcessEnv", name: options.from, replacement: "ctx.secrets" },
    };
  }
  if (options.action === "replace-import") {
    if (!options.from || !options.to) {
      diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "replace-import requires <from> <to>"));
      return { diagnostics };
    }
    return { diagnostics, intent: { kind: "replaceImport", from: options.from, to: options.to } };
  }
  return {
    diagnostics: [
      diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "unsupported refactor intent"),
    ],
  };
}

function findCommandFile(workspaceRoot: string, command: string): string | null {
  for (const file of walkFiles(workspaceRoot)) {
    if (!file.startsWith("src/commands/")) {
      continue;
    }
    const content = readText(workspaceRoot, file) ?? "";
    if (content.includes(`export const ${command}`)) {
      return file;
    }
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isCommandCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === "command") ||
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "command"));
}

function findCommandObject(sourceFile: ts.SourceFile, commandName: string): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;

  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === commandName) {
      const initializer = node.initializer;
      if (initializer && isCommandCall(initializer) && ts.isObjectLiteralExpression(initializer.arguments[0])) {
        found = initializer.arguments[0];
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findHandlerProperty(commandObject: ts.ObjectLiteralExpression): ts.PropertyAssignment | null {
  for (const property of commandObject.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    if (propertyNameText(property.name) === "handler") {
      return property;
    }
  }
  return null;
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

function isPackageImportDeclaration(statement: ts.Statement, packageName: string): statement is ts.ImportDeclaration {
  return ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    packageNameFromSpecifier(statement.moduleSpecifier.text) === packageName;
}

function isValueImportDeclarationForPackage(statement: ts.Statement, packageName: string): statement is ts.ImportDeclaration {
  if (!isPackageImportDeclaration(statement, packageName)) {
    return false;
  }
  const clause = statement.importClause;
  if (!clause) {
    return true;
  }
  if (clause.isTypeOnly) {
    return false;
  }
  if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) {
    return true;
  }
  return Boolean(
    clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.some((element) => !element.isTypeOnly),
  );
}

function removeImportForPackage(
  sourceFile: ts.SourceFile,
  source: string,
  packageName: string,
): { spans: Array<{ start: number; end: number }>; found: boolean } {
  const spans: Array<{ start: number; end: number }> = [];
  for (const statement of sourceFile.statements) {
    if (!isValueImportDeclarationForPackage(statement, packageName)) {
      continue;
    }
    let end = statement.getEnd();
    if (source.slice(end, end + 2) === "\r\n") {
      end += 2;
    } else if (source[end] === "\n") {
      end += 1;
    }
    spans.push({ start: statement.getStart(sourceFile), end });
  }
  return { spans, found: spans.length > 0 };
}

function sideEffectImportDiagnostics(
  sourceFile: ts.SourceFile,
  commandFile: string,
  packageName: string,
): Diagnostic[] {
  const sideEffectImports = sourceFile.statements.filter(
    (statement) => isPackageImportDeclaration(statement, packageName) && !statement.importClause,
  );
  if (sideEffectImports.length === 0) {
    return [];
  }
  return [
    createDiagnostic({
      severity: "error",
      code: "FORGE_REFACTOR_PATCH_UNSAFE",
      message: `package '${packageName}' has side-effect import(s) in ${commandFile}`,
      file: commandFile,
      fixHint: "Move or remove side-effect imports manually before running extract-action; they cannot be proven local to a command handler.",
    }),
  ];
}

function typeOnlyImportFromMixedPackageImport(
  statement: ts.ImportDeclaration,
  packageName: string,
): ts.ImportDeclaration | undefined {
  if (!isPackageImportDeclaration(statement, packageName)) {
    return statement;
  }
  const clause = statement.importClause;
  if (!clause) {
    return undefined;
  }
  if (clause.isTypeOnly) {
    return statement;
  }
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return undefined;
  }
  const typeElements = clause.namedBindings.elements
    .filter((element) => element.isTypeOnly)
    .map((element) => ts.factory.createImportSpecifier(
      false,
      element.propertyName ? ts.factory.createIdentifier(element.propertyName.text) : undefined,
      ts.factory.createIdentifier(element.name.text),
    ));
  if (typeElements.length === 0) {
    return undefined;
  }
  return ts.factory.updateImportDeclaration(
    statement,
    statement.modifiers,
    ts.factory.createImportClause(
      true,
      undefined,
      ts.factory.createNamedImports(typeElements),
    ),
    statement.moduleSpecifier,
    statement.attributes,
  );
}

interface ImportBinding {
  name: string;
  node: ts.Identifier;
  symbol: ts.Symbol;
}

function createCommandProgram(
  workspaceRoot: string,
  commandFile: string,
  source: string,
): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
  const absoluteFile = join(workspaceRoot, commandFile);
  const options: ts.CompilerOptions = {
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options, true);
  const originalReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => fileName === absoluteFile ? source : originalReadFile(fileName);
  const originalFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === absoluteFile || originalFileExists(fileName);

  const program = ts.createProgram([absoluteFile], options, host);
  const sourceFile = program.getSourceFile(absoluteFile);
  if (!sourceFile) {
    throw new Error(`Unable to create TypeScript source file for ${commandFile}`);
  }
  return { sourceFile, checker: program.getTypeChecker() };
}

function bindingSymbol(checker: ts.TypeChecker, node: ts.Identifier): ts.Symbol | null {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) {
    return null;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    return checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

function importBindingsForPackage(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  packageName: string,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const seen = new Set<string>();
  const pushBinding = (node: ts.Identifier): void => {
    const symbol = bindingSymbol(checker, node);
    const key = symbol ? `${node.text}:${symbol.escapedName.toString()}` : node.text;
    if (!symbol || seen.has(key)) {
      return;
    }
    bindings.push({ name: node.text, node, symbol });
    seen.add(key);
  };

  for (const statement of sourceFile.statements) {
    if (!isPackageImportDeclaration(statement, packageName)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) {
      continue;
    }
    if (clause.name) {
      pushBinding(clause.name);
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      pushBinding(clause.namedBindings.name);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) {
          continue;
        }
        pushBinding(element.name);
      }
    }
  }
  return bindings.sort((a, b) => a.name.localeCompare(b.name));
}

function isImportIdentifier(node: ts.Identifier): boolean {
  return ts.isImportClause(node.parent) ||
    ts.isNamespaceImport(node.parent) ||
    ts.isImportSpecifier(node.parent);
}

function isPropertyNameIdentifier(node: ts.Identifier): boolean {
  return (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
    (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) ||
    (ts.isBindingElement(node.parent) && node.parent.propertyName === node);
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (current.parent) {
    current = current.parent;
    if (ts.isTypeNode(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
      return true;
    }
    if (
      ts.isExpressionStatement(current) ||
      ts.isCallExpression(current) ||
      ts.isNewExpression(current) ||
      ts.isVariableDeclaration(current) ||
      ts.isReturnStatement(current) ||
      ts.isPropertyAccessExpression(current)
    ) {
      return false;
    }
  }
  return false;
}

function sameSymbol(checker: ts.TypeChecker, reference: ts.Identifier, binding: ImportBinding): boolean {
  if (reference.text !== binding.name || reference === binding.node) {
    return false;
  }
  const referenceSymbol = bindingSymbol(checker, reference);
  return referenceSymbol === binding.symbol;
}

function importReferencesInNode(
  node: ts.Node,
  checker: ts.TypeChecker,
  bindings: ImportBinding[],
): ts.Identifier[] {
  const references: ts.Identifier[] = [];
  function visit(current: ts.Node): void {
    if (
      ts.isIdentifier(current) &&
      !isImportIdentifier(current) &&
      !isPropertyNameIdentifier(current) &&
      !isTypePosition(current) &&
      bindings.some((binding) => sameSymbol(checker, current, binding))
    ) {
      references.push(current);
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return references;
}

function importedPackageUsageDiagnostics(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  commandFile: string,
  commandName: string,
  packageName: string,
  handler: ts.FunctionExpression | ts.ArrowFunction,
): Diagnostic[] {
  const bindings = importBindingsForPackage(sourceFile, checker, packageName);
  if (bindings.length === 0) {
    return [
      createDiagnostic({
        severity: "error",
        code: "FORGE_REFACTOR_PATCH_UNSAFE",
        message: `package import '${packageName}' has no value binding to analyze in ${commandFile}`,
        file: commandFile,
        fixHint: "Use extract-action only for direct value imports used by the command handler. Side-effect imports and type-only imports require a manual refactor.",
      }),
    ];
  }
  const handlerStart = handler.getFullStart();
  const handlerEnd = handler.getEnd();
  const handlerReferences = importReferencesInNode(handler.body, checker, bindings);
  if (handlerReferences.length === 0) {
    return [
      createDiagnostic({
        severity: "error",
        code: "FORGE_REFACTOR_PATCH_UNSAFE",
        message: `package import '${packageName}' is not referenced inside ${commandFile} handler`,
        file: commandFile,
        fixHint: "Run extract-action only when the forbidden package usage is local to the command handler being extracted.",
      }),
    ];
  }

  const outsideReferences = importReferencesInNode(sourceFile, checker, bindings)
    .filter((reference) => reference.getStart(sourceFile) < handlerStart || reference.getStart(sourceFile) > handlerEnd);
  if (outsideReferences.length === 0) {
    return [];
  }

  const lines = outsideReferences.slice(0, 3).map((reference) => {
    const position = sourceFile.getLineAndCharacterOfPosition(reference.getStart(sourceFile));
    return `${reference.text}@${position.line + 1}:${position.character + 1}`;
  });
  return [
    createDiagnostic({
      severity: "error",
      code: "FORGE_REFACTOR_PATCH_UNSAFE",
      message: `package import '${packageName}' is referenced outside the extracted handler: ${lines.join(", ")}`,
      file: commandFile,
      fixHint: "Move non-handler package usage first, or extract a smaller helper manually before running extract-action.",
      suggestedCommands: [`forge refactor extract-action ${commandName} --package ${packageName} --dry-run --json`],
    }),
  ];
}

function createExtractedHandlerBody(
  ctxName: string,
  inputName: string | null,
  eventName: string,
): ts.Block {
  const payload = inputName
    ? ts.factory.createIdentifier(inputName)
    : ts.factory.createObjectLiteralExpression([], false);
  return ts.factory.createBlock([
    ts.factory.createExpressionStatement(
      ts.factory.createAwaitExpression(
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(ctxName), "emit"),
          undefined,
          [ts.factory.createStringLiteral(eventName), payload],
        ),
      ),
    ),
    ts.factory.createReturnStatement(
      ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment("emitted", ts.factory.createStringLiteral(eventName)),
      ], false),
    ),
  ], true);
}

function rewriteExtractActionSource(
  sourceFile: ts.SourceFile,
  handler: ts.FunctionExpression | ts.ArrowFunction,
  ctxName: string,
  inputName: string | null,
  intent: Extract<RefactorIntent, { kind: "extractAction" }>,
): string {
  const newBody = createExtractedHandlerBody(ctxName, inputName, intent.eventName);
  const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node) && isPackageImportDeclaration(node, intent.packageName)) {
        return typeOnlyImportFromMixedPackageImport(node, intent.packageName);
      }
      if (node === handler) {
        if (ts.isArrowFunction(node)) {
          return ts.factory.updateArrowFunction(
            node,
            node.modifiers,
            node.typeParameters,
            node.parameters,
            node.type,
            node.equalsGreaterThanToken,
            newBody,
          );
        }
        if (ts.isFunctionExpression(node)) {
          return ts.factory.updateFunctionExpression(
            node,
            node.modifiers,
            node.asteriskToken,
            node.name,
            node.typeParameters,
            node.parameters,
            node.type,
            newBody,
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

function rewriteExtractActionCommand(
  workspaceRoot: string,
  source: string,
  commandFile: string,
  intent: Extract<RefactorIntent, { kind: "extractAction" }>,
): { after?: string; diagnostics: Diagnostic[] } {
  const { sourceFile, checker } = createCommandProgram(workspaceRoot, commandFile, source);
  const commandObject = findCommandObject(sourceFile, intent.command);
  if (!commandObject) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_REFACTOR_PATCH_UNSAFE",
          message: `could not find command(${intent.command}) object literal for AST rewrite`,
          file: commandFile,
          fixHint: "Ensure the command is declared as `export const name = command({ handler: ... })`, then re-run extract-action.",
          suggestedCommands: [`forge refactor extract-action ${intent.command} --package ${intent.packageName} --dry-run --json`],
        }),
      ],
    };
  }

  const handlerProperty = findHandlerProperty(commandObject);
  if (!handlerProperty) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `command '${intent.command}' has no handler property`, commandFile),
      ],
    };
  }

  const handler = handlerProperty.initializer;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `command '${intent.command}' handler is not a function expression`, commandFile),
      ],
    };
  }
  if (!ts.isBlock(handler.body)) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `command '${intent.command}' handler must use a block body`, commandFile),
      ],
    };
  }
  const ctxParam = handler.parameters[0]?.name;
  if (!ctxParam || !ts.isIdentifier(ctxParam)) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `command '${intent.command}' handler must have an identifier ctx parameter`, commandFile),
      ],
    };
  }
  const inputParam = handler.parameters[1]?.name;
  if (inputParam && !ts.isIdentifier(inputParam)) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `command '${intent.command}' input parameter must be an identifier`, commandFile),
      ],
    };
  }

  const imports = removeImportForPackage(sourceFile, source, intent.packageName);
  if (!imports.found) {
    return {
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_REFACTOR_TARGET_NOT_FOUND",
          message: `package import '${intent.packageName}' was not found in ${commandFile}`,
          file: commandFile,
          fixHint: "extract-action currently rewrites direct imports in the command file. Move the forbidden import into the command or extract the helper manually first.",
          suggestedCommands: ["forge inspect runtime-matrix --json", "forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json"],
        }),
      ],
    };
  }

  const sideEffectDiagnostics = sideEffectImportDiagnostics(sourceFile, commandFile, intent.packageName);
  if (sideEffectDiagnostics.length > 0) {
    return { diagnostics: sideEffectDiagnostics };
  }

  const usageDiagnostics = importedPackageUsageDiagnostics(sourceFile, checker, commandFile, intent.command, intent.packageName, handler);
  if (usageDiagnostics.length > 0) {
    return { diagnostics: usageDiagnostics };
  }

  const after = rewriteExtractActionSource(
    sourceFile,
    handler,
    ctxParam.text,
    inputParam ? inputParam.text : null,
    intent,
  );

  return { after, diagnostics: [] };
}

function safePackageIdentifier(packageName: string): string {
  const base = packageName
    .replace(/^@/, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  const identifier = `${base || "Package"}Integration`;
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Package${identifier}`;
}

function renderSourceFile(statements: ts.Statement[]): string {
  const file = ts.factory.createSourceFile(
    statements,
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None,
  );
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return `${printer.printFile(file)}\n`;
}

function buildExtractedActionContent(intent: Extract<RefactorIntent, { kind: "extractAction" }>): string {
  const packageIdentifier = safePackageIdentifier(intent.packageName);
  const eventType = ts.factory.createTypeReferenceNode("Record", [
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
  ]);
  const handler = ts.factory.createArrowFunction(
    [ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
    undefined,
    [
      ts.factory.createParameterDeclaration(undefined, undefined, "ctx"),
      ts.factory.createParameterDeclaration(undefined, undefined, "event", undefined, eventType),
    ],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    ts.factory.createBlock([
      ts.factory.createExpressionStatement(
        ts.factory.createVoidExpression(ts.factory.createIdentifier(packageIdentifier)),
      ),
      ts.factory.createExpressionStatement(
        ts.factory.createAwaitExpression(
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("ctx"), "telemetry"),
              "capture",
            ),
            undefined,
            [
              ts.factory.createStringLiteral(`${intent.actionName}_requested`),
              ts.factory.createObjectLiteralExpression([
                ts.factory.createShorthandPropertyAssignment("event"),
                ts.factory.createPropertyAssignment("integration", ts.factory.createStringLiteral(intent.packageName)),
              ], true),
            ],
          ),
        ),
      ),
      ts.factory.createReturnStatement(
        ts.factory.createObjectLiteralExpression([
          ts.factory.createPropertyAssignment("processed", ts.factory.createTrue()),
        ], false),
      ),
    ], true),
  );

  return renderSourceFile([
    ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamedImports([
          ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("action")),
        ]),
      ),
      ts.factory.createStringLiteral("forge/server"),
    ),
    ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamespaceImport(ts.factory.createIdentifier(packageIdentifier)),
      ),
      ts.factory.createStringLiteral(intent.packageName),
    ),
    ts.factory.createVariableStatement(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createVariableDeclarationList([
        ts.factory.createVariableDeclaration(
          intent.actionName,
          undefined,
          undefined,
          ts.factory.createCallExpression(ts.factory.createIdentifier("action"), undefined, [
            ts.factory.createObjectLiteralExpression([
              ts.factory.createPropertyAssignment("event", ts.factory.createStringLiteral(intent.eventName)),
              ts.factory.createPropertyAssignment("handler", handler),
            ], true),
          ]),
        ),
      ], ts.NodeFlags.Const),
    ),
  ]);
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

function renamePropertyName(name: ts.PropertyName, from: string, to: string, prefixMode = false): ts.PropertyName {
  if (ts.isIdentifier(name) && name.text === from) {
    return renameIdentifierNode(to);
  }
  if (ts.isStringLiteral(name)) {
    const next = renameStringValue(name.text, from, to, prefixMode);
    if (next !== name.text) {
      return ts.factory.createStringLiteral(next);
    }
  }
  return name;
}

function renameStringValue(value: string, from: string, to: string, prefixMode: boolean): string {
  if (value === from) {
    return to;
  }
  if (prefixMode && value.startsWith(`${from}.`)) {
    return `${to}${value.slice(from.length)}`;
  }
  return value;
}

function renameStringLiteralNode<T extends ts.StringLiteral | ts.NoSubstitutionTemplateLiteral>(
  node: T,
  from: string,
  to: string,
  prefixMode: boolean,
): T {
  const next = renameStringValue(node.text, from, to, prefixMode);
  if (next === node.text) {
    return node;
  }
  return (ts.isNoSubstitutionTemplateLiteral(node)
    ? ts.factory.createNoSubstitutionTemplateLiteral(next)
    : ts.factory.createStringLiteral(next)) as T;
}

function isDefineTableCall(expression: ts.Expression | undefined): boolean {
  return (
    expression !== undefined &&
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "defineTable"
  );
}

function renameFieldInSource(source: string, file: string, from: string, to: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === from) {
        return ts.factory.updatePropertyAccessExpression(node, node.expression, renameIdentifierNode(to));
      }
      if (ts.isPropertyAssignment(node)) {
        return ts.factory.updatePropertyAssignment(
          node,
          renamePropertyName(node.name, from, to),
          ts.visitNode(node.initializer, visit, ts.isExpression) ?? node.initializer,
        );
      }
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === from) {
        return ts.factory.createPropertyAssignment(to, node.name);
      }
      if (ts.isPropertySignature(node)) {
        return ts.factory.updatePropertySignature(
          node,
          node.modifiers,
          renamePropertyName(node.name, from, to),
          node.questionToken,
          node.type,
        );
      }
      if (ts.isBindingElement(node) && node.propertyName) {
        return ts.factory.updateBindingElement(
          node,
          node.dotDotDotToken,
          renamePropertyName(node.propertyName, from, to),
          node.name,
          node.initializer,
        );
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === from && !node.propertyName) {
        return ts.factory.updateBindingElement(
          node,
          node.dotDotDotToken,
          ts.factory.createIdentifier(to),
          node.name,
          node.initializer,
        );
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return renameStringLiteralNode(node, from, to, false);
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === from) {
        return ts.factory.updateJsxAttribute(node, ts.factory.createIdentifier(to), node.initializer);
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

function renameTableInSource(source: string, file: string, from: string, to: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const transform: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === from &&
        isDefineTableCall(node.initializer)
      ) {
        return ts.factory.updateVariableDeclaration(
          node,
          renameIdentifierNode(to),
          node.exclamationToken,
          node.type,
          ts.visitNode(node.initializer, visit, ts.isExpression) ?? node.initializer,
        );
      }
      if (ts.isImportSpecifier(node)) {
        if (node.propertyName?.text === from) {
          return ts.factory.updateImportSpecifier(node, node.isTypeOnly, renameIdentifierNode(to), node.name);
        }
        if (!node.propertyName && node.name.text === from) {
          return ts.factory.updateImportSpecifier(node, node.isTypeOnly, undefined, renameIdentifierNode(to));
        }
      }
      if (ts.isExportSpecifier(node)) {
        if (node.propertyName?.text === from) {
          return ts.factory.updateExportSpecifier(node, node.isTypeOnly, renameIdentifierNode(to), node.name);
        }
        if (!node.propertyName && node.name.text === from) {
          return ts.factory.updateExportSpecifier(node, node.isTypeOnly, undefined, renameIdentifierNode(to));
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === from) {
        return ts.factory.updatePropertyAccessExpression(node, node.expression, renameIdentifierNode(to));
      }
      if (ts.isPropertyAssignment(node)) {
        return ts.factory.updatePropertyAssignment(
          node,
          renamePropertyName(node.name, from, to, true),
          ts.visitNode(node.initializer, visit, ts.isExpression) ?? node.initializer,
        );
      }
      if (ts.isPropertySignature(node)) {
        return ts.factory.updatePropertySignature(
          node,
          node.modifiers,
          renamePropertyName(node.name, from, to, true),
          node.questionToken,
          node.type,
        );
      }
      if (ts.isBindingElement(node) && node.propertyName) {
        return ts.factory.updateBindingElement(
          node,
          node.dotDotDotToken,
          renamePropertyName(node.propertyName, from, to),
          node.name,
          node.initializer,
        );
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return renameStringLiteralNode(node, from, to, true);
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

function renameJsonValue(value: unknown, from: string, to: string, prefixMode: boolean): unknown {
  if (typeof value === "string") {
    return renameStringValue(value, from, to, prefixMode);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renameJsonValue(entry, from, to, prefixMode));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const nextKey = renameStringValue(key, from, to, prefixMode);
      output[nextKey] = renameJsonValue(entry, from, to, prefixMode);
    }
    return output;
  }
  return value;
}

function renameInJson(source: string, from: string, to: string, prefixMode: boolean): string {
  const parsed = JSON.parse(source) as unknown;
  return `${JSON.stringify(renameJsonValue(parsed, from, to, prefixMode), null, 2)}\n`;
}

function renameFieldContent(source: string, file: string, intent: Extract<RefactorIntent, { kind: "renameField" }>): string {
  if (isTypeScriptLike(file)) {
    return renameFieldInSource(source, file, intent.from.field, intent.to.field);
  }
  if (file.endsWith(".json")) {
    return renameInJson(source, intent.from.field, intent.to.field, false);
  }
  return wordReplace(source, intent.from.field, intent.to.field);
}

function renameTableContent(source: string, file: string, intent: Extract<RefactorIntent, { kind: "renameTable" }>): string {
  if (isTypeScriptLike(file)) {
    return renameTableInSource(source, file, intent.from.table, intent.to.table);
  }
  if (file.endsWith(".json")) {
    return renameInJson(source, intent.from.table, intent.to.table, true);
  }
  return wordReplace(source, intent.from.table, intent.to.table);
}

function buildRenameFieldPlan(workspaceRoot: string, intent: Extract<RefactorIntent, { kind: "renameField" }>): {
  patches: PlannedPatch[];
  diagnostics: Diagnostic[];
} {
  const patches: PlannedPatch[] = [];
  const diagnostics: Diagnostic[] = [];
  const files = walkFiles(workspaceRoot);
  let found = false;
  for (const file of files) {
    const content = readText(workspaceRoot, file) ?? "";
    if (!content.includes(intent.from.field)) {
      continue;
    }
    if (file.endsWith(".md") && !content.includes(intent.table)) {
      diagnostics.push(
        diagnostic(
          "warning",
          "FORGE_REFACTOR_AMBIGUOUS_REFERENCE",
          `possible unrelated field reference in ${file}`,
          file,
        ),
      );
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      `Rename field ${intent.table}.${intent.from.field} to ${intent.to.field}`,
      (source) => renameFieldContent(source, file, intent),
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
        "FORGE_REFACTOR_FIELD_NOT_FOUND",
        `field '${intent.table}.${intent.from.field}' was not found`,
      ),
    );
  }
  return { patches, diagnostics };
}

function buildRenameTablePlan(workspaceRoot: string, intent: Extract<RefactorIntent, { kind: "renameTable" }>): {
  patches: PlannedPatch[];
  diagnostics: Diagnostic[];
} {
  const patches: PlannedPatch[] = [];
  let found = false;
  for (const file of walkFiles(workspaceRoot)) {
    const content = readText(workspaceRoot, file) ?? "";
    if (!content.includes(intent.from.table)) {
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      `Rename table ${intent.from.table} to ${intent.to.table}`,
      (source) => renameTableContent(source, file, intent),
    );
    if (patch) {
      found = true;
      patches.push(patch);
    }
  }
  return {
    patches,
    diagnostics: found
      ? []
      : [diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `table '${intent.from.table}' was not found`)],
  };
}

function buildStringRenamePlan(
  workspaceRoot: string,
  from: string,
  to: string,
  description: string,
): { patches: PlannedPatch[]; diagnostics: Diagnostic[] } {
  const patches: PlannedPatch[] = [];
  let found = false;
  for (const file of walkFiles(workspaceRoot)) {
    const content = readText(workspaceRoot, file) ?? "";
    if (!content.includes(from)) {
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      description,
      (source) => source.split(from).join(to),
    );
    if (patch) {
      found = true;
      patches.push(patch);
    }
  }
  return {
    patches,
    diagnostics: found
      ? []
      : [diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `target '${from}' was not found`)],
  };
}

function buildMoveComponentPlan(workspaceRoot: string, intent: Extract<RefactorIntent, { kind: "moveComponent" }>): {
  patches: PlannedPatch[];
  filesToCreate: PlannedFile[];
  filesToDelete: Array<{ file: string; description: string }>;
  diagnostics: Diagnostic[];
} {
  const sourceFile = walkFiles(workspaceRoot).find(
    (file) =>
      file.endsWith(`${intent.name}.tsx`) ||
      (file.endsWith(".tsx") && (readText(workspaceRoot, file) ?? "").includes(`function ${intent.name}`)),
  );
  if (!sourceFile) {
    return {
      patches: [],
      filesToCreate: [],
      filesToDelete: [],
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `component '${intent.name}' was not found`),
      ],
    };
  }
  if (isGenerated(intent.toPath)) {
    return {
      patches: [],
      filesToCreate: [],
      filesToDelete: [],
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_REFACTOR_GENERATED_FILE_EDIT_BLOCKED",
          "cannot move component into generated directory",
          intent.toPath,
        ),
      ],
    };
  }
  const content = readText(workspaceRoot, sourceFile) ?? "";
  const fromNoExt = sourceFile.replace(/\.[tj]sx?$/, "");
  const toNoExt = intent.toPath.replace(/\.[tj]sx?$/, "");
  const patches: PlannedPatch[] = [];
  for (const file of walkFiles(workspaceRoot)) {
    if (file === sourceFile) {
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      `Update imports for moved component ${intent.name}`,
      (source) => source.split(fromNoExt).join(toNoExt),
    );
    if (patch) {
      patches.push(patch);
    }
  }
  return {
    patches,
    filesToCreate: [makeFile(workspaceRoot, intent.toPath, `Move component ${intent.name}`, content)],
    filesToDelete: [{ file: sourceFile, description: `Remove old component path for ${intent.name}` }],
    diagnostics: [],
  };
}

function buildExtractActionPlan(workspaceRoot: string, intent: Extract<RefactorIntent, { kind: "extractAction" }>): {
  patches: PlannedPatch[];
  filesToCreate: PlannedFile[];
  diagnostics: Diagnostic[];
} {
  const commandFile = findCommandFile(workspaceRoot, intent.command);
  if (!commandFile) {
    return {
      patches: [],
      filesToCreate: [],
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `command '${intent.command}' was not found`),
      ],
    };
  }
  const commandSource = readText(workspaceRoot, commandFile);
  if (commandSource === null) {
    return {
      patches: [],
      filesToCreate: [],
      diagnostics: [
        diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `command file '${commandFile}' was not found`, commandFile),
      ],
    };
  }
  const rewrite = rewriteExtractActionCommand(workspaceRoot, commandSource, commandFile, intent);
  const commandPatch = rewrite.after
    ? makePatchFromContent(
      commandFile,
      `Extract ${intent.packageName} side effect from ${intent.command}`,
      commandSource,
      rewrite.after,
    )
    : null;
  const actionFile = `src/actions/${intent.actionName}.ts`;
  const actionContent = buildExtractedActionContent(intent);
  return {
    patches: commandPatch ? [commandPatch] : [],
    filesToCreate: commandPatch
      ? [makeFile(workspaceRoot, actionFile, `Create extracted action ${intent.actionName}`, actionContent)]
      : [],
    diagnostics: commandPatch
      ? rewrite.diagnostics
      : rewrite.diagnostics.length > 0
        ? rewrite.diagnostics
        : [diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `could not safely rewrite command '${intent.command}'`, commandFile)],
  };
}

function buildReplaceProcessEnvPlan(workspaceRoot: string, intent: Extract<RefactorIntent, { kind: "replaceProcessEnv" }>): {
  patches: PlannedPatch[];
  diagnostics: Diagnostic[];
} {
  const patches: PlannedPatch[] = [];
  const diagnostics: Diagnostic[] = [];
  let found = false;
  for (const file of walkFiles(workspaceRoot)) {
    const content = readText(workspaceRoot, file) ?? "";
    const needle = `process.env.${intent.name}`;
    if (!content.includes(needle) && !content.includes(`process.env[${JSON.stringify(intent.name)}]`)) {
      continue;
    }
    found = true;
    if (file.endsWith(".tsx") || file.includes("/components/") || file.includes("\\components\\")) {
      diagnostics.push(
        diagnostic("error", "FORGE_REFACTOR_SECRET_IN_CLIENT", `secret env var used in client-like file ${file}`, file),
      );
      continue;
    }
    if (!content.includes("ctx")) {
      diagnostics.push(
        diagnostic("error", "FORGE_REFACTOR_CTX_NOT_AVAILABLE", `ctx is not available in ${file}`, file),
      );
      continue;
    }
    const patch = patchFile(
      workspaceRoot,
      file,
      `Replace process.env.${intent.name} with ctx.secrets`,
      (source) =>
        source
          .split(needle)
          .join(`ctx.secrets.get(${JSON.stringify(intent.name)})`)
          .split(`process.env[${JSON.stringify(intent.name)}]`)
          .join(`ctx.secrets.get(${JSON.stringify(intent.name)})`),
    );
    if (patch) {
      patches.push(patch);
    }
  }
  if (!found) {
    diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", `process.env.${intent.name} was not found`));
  }
  return { patches, diagnostics };
}

function planParts(workspaceRoot: string, intent: RefactorIntent): {
  patches: PlannedPatch[];
  filesToCreate: PlannedFile[];
  filesToDelete: Array<{ file: string; description: string }>;
  diagnostics: Diagnostic[];
} {
  if (intent.kind === "renameField") {
    const result = buildRenameFieldPlan(workspaceRoot, intent);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "renameTable") {
    const result = buildRenameTablePlan(workspaceRoot, intent);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "renamePolicy") {
    const result = buildStringRenamePlan(workspaceRoot, intent.from, intent.to, `Rename policy ${intent.from} to ${intent.to}`);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "renameEvent") {
    const result = buildStringRenamePlan(workspaceRoot, intent.from, intent.to, `Rename event ${intent.from} to ${intent.to}`);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "renameRuntimeEntry") {
    const result = buildStringRenamePlan(workspaceRoot, intent.from, intent.to, `Rename ${intent.entryKind} ${intent.from} to ${intent.to}`);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "moveComponent") {
    const result = buildMoveComponentPlan(workspaceRoot, intent);
    return result;
  }
  if (intent.kind === "extractAction") {
    const result = buildExtractActionPlan(workspaceRoot, intent);
    return { patches: result.patches, filesToCreate: result.filesToCreate, filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "replaceProcessEnv") {
    const result = buildReplaceProcessEnvPlan(workspaceRoot, intent);
    return { patches: result.patches, filesToCreate: [], filesToDelete: [], diagnostics: result.diagnostics };
  }
  if (intent.kind === "replaceImport") {
    const result = buildStringRenamePlan(workspaceRoot, `from "${intent.from}"`, `from "${intent.to}"`, `Replace import ${intent.from}`);
    const single = buildStringRenamePlan(workspaceRoot, `from '${intent.from}'`, `from '${intent.to}'`, `Replace import ${intent.from}`);
    return { patches: [...result.patches, ...single.patches], filesToCreate: [], filesToDelete: [], diagnostics: [...result.diagnostics, ...single.diagnostics].filter((diag, _, arr) => arr.length < 2 || diag.severity !== "error") };
  }
  return {
    patches: [],
    filesToCreate: [],
    filesToDelete: [],
    diagnostics: [
      diagnostic("error", "FORGE_REFACTOR_TARGET_NOT_FOUND", "unsupported refactor intent"),
    ],
  };
}

function summarizeIntent(intent: RefactorIntent): string {
  if (intent.kind === "renameField") {
    return `Rename ${intent.table}.${intent.from.field} to ${intent.table}.${intent.to.field}`;
  }
  if (intent.kind === "renameTable") {
    return `Rename table ${intent.from.table} to ${intent.to.table}`;
  }
  if (intent.kind === "renamePolicy") {
    return `Rename policy ${intent.from} to ${intent.to}`;
  }
  if (intent.kind === "renameRuntimeEntry") {
    return `Rename ${intent.entryKind} ${intent.from} to ${intent.to}`;
  }
  if (intent.kind === "renameEvent") {
    return `Rename event ${intent.from} to ${intent.to}`;
  }
  if (intent.kind === "moveComponent") {
    return `Move component ${intent.name} to ${intent.toPath}`;
  }
  if (intent.kind === "extractAction") {
    return `Extract ${intent.packageName} usage from ${intent.command}`;
  }
  if (intent.kind === "replaceProcessEnv") {
    return `Replace process.env.${intent.name}`;
  }
  return `Replace import ${intent.from} to ${intent.to}`;
}

function migrationPlan(intent: RefactorIntent): RefactorPlan["migrationPlan"] {
  if (intent.kind === "renameField") {
    return {
      strategy: "rename-column",
      sql: [`ALTER TABLE ${intent.table} RENAME COLUMN ${intent.from.field} TO ${intent.to.field};`],
    };
  }
  if (intent.kind === "renameTable") {
    return {
      strategy: "rename-table",
      sql: [`ALTER TABLE ${intent.from.table} RENAME TO ${intent.to.table};`],
    };
  }
  return undefined;
}

function impact(intent: RefactorIntent, patches: PlannedPatch[], creates: PlannedFile[]): RefactorImpact {
  const result = emptyImpact();
  for (const patch of patches) {
    if (patch.file.startsWith(".forge/blueprints/")) {
      pushUnique(result.blueprints, patch.file);
    } else if (patch.file.includes("/components/") || patch.file.endsWith(".tsx")) {
      pushUnique(result.frontend.components, patch.file);
    } else if (patch.file.includes("/queries/")) {
      pushUnique(result.runtime.queries, patch.file);
    } else if (patch.file.includes("/commands/")) {
      pushUnique(result.runtime.commands, patch.file);
    } else if (patch.file.includes("/actions/")) {
      pushUnique(result.runtime.actions, patch.file);
    } else if (patch.file.includes("/workflows/")) {
      pushUnique(result.runtime.workflows, patch.file);
    } else if (patch.file.includes("/tests/")) {
      pushUnique(result.tests, patch.file);
    }
  }
  for (const file of creates) {
    if (file.file.includes("/actions/")) {
      pushUnique(result.runtime.actions, file.file);
    }
    if (file.file.endsWith(".tsx")) {
      pushUnique(result.frontend.components, file.file);
    }
  }
  if (intent.kind === "renameField") {
    pushUnique(result.data.fields, `${intent.table}.${intent.from.field}`);
  }
  if (intent.kind === "renameTable") {
    pushUnique(result.data.tables, intent.from.table);
  }
  if (intent.kind === "renamePolicy") {
    pushUnique(result.policies, intent.from);
  }
  return result;
}

function risk(intent: RefactorIntent): RefactorPlan["risk"] {
  if (intent.kind === "renameTable") {
    return { level: "high", reasons: ["table rename requires database migration and client API changes"] };
  }
  if (intent.kind === "renameField") {
    return { level: "medium", reasons: ["field rename may require database migration"] };
  }
  if (intent.kind === "renameRuntimeEntry") {
    return { level: "medium", reasons: ["runtime entry rename changes public API"] };
  }
  if (intent.kind === "extractAction") {
    return { level: "medium", reasons: ["extracts side effect into after-commit action"] };
  }
  return { level: "low", reasons: [] };
}

export function buildRefactorPlan(options: RefactorCommandOptions): RefactorResult {
  const parsed = inferIntent(options);
  if (!parsed.intent) {
    return { ok: false, diagnostics: parsed.diagnostics, exitCode: 1 };
  }
  const parts = planParts(options.workspaceRoot, parsed.intent);
  const id = `refactor_${hashStable(canonicalJson(parsed.intent)).slice(0, 12)}`;
  const trackedFiles = [
    ...parts.patches.map((patch) => patch.file),
    ...parts.filesToCreate.map((file) => file.file),
    ...parts.filesToDelete.map((file) => file.file),
  ].filter((value, index, array) => array.indexOf(value) === index).sort();
  const plan: RefactorPlan = {
    schemaVersion: "0.1.0",
    refactorVersion: GENERATOR_VERSION,
    id,
    intent: parsed.intent,
    summary: summarizeIntent(parsed.intent),
    impact: impact(parsed.intent, parts.patches, parts.filesToCreate),
    filesToModify: parts.patches,
    filesToCreate: parts.filesToCreate,
    filesToDelete: parts.filesToDelete,
    generatedImpacts: emptyImpact().generatedArtifacts,
    migrationPlan: migrationPlan(parsed.intent),
    risk: risk(parsed.intent),
    commandsToRun: ["forge generate", "forge verify --strict"],
    diagnostics: [...parsed.diagnostics, ...parts.diagnostics],
    rollback: {
      trackedFiles,
      instructions: [`forge refactor rollback ${id}`],
    },
  };
  if (parts.patches.some((patch) => isGenerated(patch.file))) {
    plan.diagnostics.push(
      diagnostic(
        "error",
        "FORGE_REFACTOR_GENERATED_FILE_EDIT_BLOCKED",
        "refactor attempted to patch generated files",
      ),
    );
  }
  const ok = !plan.diagnostics.some((diag) => diag.severity === "error");
  return { ok, plan, diagnostics: plan.diagnostics, exitCode: ok ? 0 : 1 };
}

function planPath(_workspaceRoot: string, id: string): string {
  return `${REFACTOR_DIR}/${id}/plan.json`;
}

function snapshotPath(id: string): string {
  return `${REFACTOR_DIR}/${id}/rollback.json`;
}

function recordPath(id: string): string {
  return `${REFACTOR_DIR}/${id}/applied.json`;
}

export function writeRefactorPlan(workspaceRoot: string, plan: RefactorPlan): string {
  const path = planPath(workspaceRoot, plan.id);
  writeText(workspaceRoot, path, serializeCanonical(plan));
  writeText(workspaceRoot, `${REFACTOR_DIR}/${plan.id}/plan.md`, renderRefactorMarkdown(plan));
  return path;
}

export function readRefactorPlan(workspaceRoot: string, idOrPath: string): RefactorPlan | null {
  const candidates = [idOrPath, planPath(workspaceRoot, idOrPath), `${REFACTOR_DIR}/${idOrPath}/plan.json`];
  for (const candidate of candidates) {
    const content = readText(workspaceRoot, candidate);
    if (content) {
      return JSON.parse(content) as RefactorPlan;
    }
  }
  return null;
}

function writeSnapshot(workspaceRoot: string, plan: RefactorPlan): void {
  const files: SnapshotFile[] = [];
  for (const file of plan.rollback.trackedFiles) {
    const content = readText(workspaceRoot, file);
    files.push({ file, existed: content !== null, ...(content !== null ? { content } : {}) });
  }
  const snapshot: RefactorSnapshot = { schemaVersion: "0.1.0", id: plan.id, files };
  writeText(workspaceRoot, snapshotPath(plan.id), serializeCanonical(snapshot));
}

export function rollbackRefactor(workspaceRoot: string, id: string): RefactorResult {
  const raw = readText(workspaceRoot, snapshotPath(id));
  const plan = readRefactorPlan(workspaceRoot, id) ?? undefined;
  if (!raw) {
    return {
      ok: false,
      plan,
      diagnostics: [diagnostic("error", "FORGE_REFACTOR_ROLLBACK_FAILED", `missing rollback snapshot for ${id}`)],
      exitCode: 1,
    };
  }
  const snapshot = JSON.parse(raw) as RefactorSnapshot;
  for (const file of snapshot.files) {
    if (file.existed) {
      writeText(workspaceRoot, file.file, file.content ?? "");
    } else {
      removeFile(workspaceRoot, file.file);
    }
  }
  const record: RefactorRecord = {
    schemaVersion: "0.1.0",
    id,
    status: "rolled-back",
    summary: plan?.summary ?? id,
    filesModified: plan?.filesToModify.map((patch) => patch.file) ?? [],
    filesCreated: plan?.filesToCreate.map((file) => file.file) ?? [],
    result: { ok: true },
  };
  writeText(workspaceRoot, recordPath(id), serializeCanonical(record));
  return { ok: true, plan, record, diagnostics: [], explanation: `Rolled back ${id}`, exitCode: 0 };
}

export function applyRefactorPlan(workspaceRoot: string, plan: RefactorPlan, force: boolean): RefactorResult {
  const diagnostics = [...plan.diagnostics];
  if (diagnostics.some((diag) => diag.severity === "error")) {
    return { ok: false, plan, diagnostics, exitCode: 1 };
  }
  writeRefactorPlan(workspaceRoot, plan);
  writeSnapshot(workspaceRoot, plan);
  for (const file of plan.filesToCreate) {
    if (file.exists && !force) {
      diagnostics.push(diagnostic("error", "FORGE_REFACTOR_TARGET_EXISTS", `file already exists: ${file.file}`, file.file));
      continue;
    }
    writeText(workspaceRoot, file.file, file.content);
  }
  for (const patch of plan.filesToModify) {
    const current = readText(workspaceRoot, patch.file);
    if (patch.beforeHash && current !== null && hashStable(current) !== patch.beforeHash) {
      diagnostics.push(diagnostic("error", "FORGE_REFACTOR_PATCH_UNSAFE", `file changed after plan was created: ${patch.file}`, patch.file));
      continue;
    }
    writeText(workspaceRoot, patch.file, patch.afterPreview);
  }
  for (const file of plan.filesToDelete) {
    removeFile(workspaceRoot, file.file);
  }
  const ok = !diagnostics.some((diag) => diag.severity === "error");
  const record: RefactorRecord = {
    schemaVersion: "0.1.0",
    id: plan.id,
    status: ok ? "applied" : "rolled-back",
    summary: plan.summary,
    filesModified: plan.filesToModify.map((patch) => patch.file),
    filesCreated: plan.filesToCreate.map((file) => file.file),
    result: { ok },
  };
  writeText(workspaceRoot, recordPath(plan.id), serializeCanonical(record));
  return { ok, plan, record, diagnostics, exitCode: ok ? 0 : 1 };
}

export function listRefactors(workspaceRoot: string): RefactorRecord[] {
  const records: RefactorRecord[] = [];
  for (const entry of readDirEntries(workspaceRoot, REFACTOR_DIR)) {
    if (!entry.isDirectory) {
      continue;
    }
    const record = readText(workspaceRoot, `${REFACTOR_DIR}/${entry.name}/applied.json`);
    if (record) {
      records.push(JSON.parse(record) as RefactorRecord);
    }
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export function renderRefactorDiff(plan: RefactorPlan): string {
  const lines: string[] = [];
  for (const file of plan.filesToCreate) {
    lines.push(`diff --forge-refactor ${file.file}`, `+++ ${file.file}`);
    for (const line of file.content.split(/\r?\n/)) {
      lines.push(`+${line}`);
    }
  }
  for (const patch of plan.filesToModify) {
    lines.push(`diff --forge-refactor ${patch.file}`, `--- ${patch.file}`, `+++ ${patch.file}`);
    for (const line of patch.afterPreview.split(/\r?\n/).slice(0, 120)) {
      lines.push(`+${line}`);
    }
  }
  for (const file of plan.filesToDelete) {
    lines.push(`diff --forge-refactor ${file.file}`, `--- ${file.file}`, `deleted file`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderRefactorMarkdown(plan: RefactorPlan): string {
  return `# Refactor plan: ${plan.id}

${plan.summary}

Risk: ${plan.risk.level}

## Will modify

${plan.filesToModify.map((patch) => `- ${patch.file}`).join("\n") || "- none"}

## Will create

${plan.filesToCreate.map((file) => `- ${file.file}`).join("\n") || "- none"}

## Will delete

${plan.filesToDelete.map((file) => `- ${file.file}`).join("\n") || "- none"}

## Generated impacts

${plan.generatedImpacts.map((file) => `- ${file}`).join("\n") || "- none"}

${plan.migrationPlan ? `## Migration hint\n\n${plan.migrationPlan.sql.map((sql) => `\`\`\`sql\n${sql}\n\`\`\``).join("\n")}` : ""}
`;
}
