import ts from "typescript";
import type { AdapterResult, AnalysisSource, RepositoryNode } from "../types.ts";
import { emptyResult, evidence, makeEdge, makeNode, staticHttpPath } from "./common.ts";

/** Parses JS/TS with the bundled compiler; resolves lexical references without loading libraries/dependencies. */
export function analyzeTypeScript(source: AnalysisSource, scriptText = source.text, offset = 0, scriptLanguage?: string): AdapterResult {
  const result = emptyResult();
  const filename = source.path.endsWith(".vue") ? `${source.path}.${scriptLanguage ?? "js"}` : source.path;
  const kind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : filename.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filename, scriptText, ts.ScriptTarget.Latest, true, kind);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
  const host: ts.CompilerHost = {
    getSourceFile: (path) => path === filename ? sourceFile : undefined,
    getDefaultLibFileName: () => "", writeFile: () => undefined,
    getCurrentDirectory: () => "/", getDirectories: () => [],
    fileExists: (path) => path === filename, readFile: (path) => path === filename ? scriptText : undefined,
    getCanonicalFileName: (path) => path, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const program = ts.createProgram([filename], options, host);
  const checker = program.getTypeChecker();
  for (const diagnostic of program.getSyntacticDiagnostics(sourceFile)) result.diagnostics.push({ code: "REPOSITORY_TS_PARSE", severity: "error", file: source.path, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") });
  const declarations = new Map<ts.Symbol, RepositoryNode>();
  const owners = new Map<ts.Node, RepositoryNode>();
  const importBindings = new Map<string, { node: RepositoryNode; imported: string }>();
  const scopeName = (node: ts.Node): string => {
    const parts: string[] = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((ts.isClassDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) parts.unshift(parent.name.getText(sourceFile));
    }
    return parts.join(".");
  };
  const addDeclaration = (node: ts.Node, name: ts.Identifier | ts.StringLiteral, kind: string) => {
    const scope = scopeName(node);
    const qualified = scope ? `${scope}.${name.text}` : name.text;
    const symbol = checker.getSymbolAtLocation(name);
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const repositoryNode = makeNode(source, "symbol", name.text, offset + node.getStart(sourceFile), offset + node.end, { symbolKind: kind, qualifiedName: qualified, exported: modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) || ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent) && ts.getModifiers(node.parent.parent)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) || false, defaultExport: modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) || false }, `${qualified}:${kind}:${offset + node.pos}`);
    // Position is only a disambiguator for repeated declarations; edits never alias a different symbol silently.
    if (symbol) declarations.set(symbol, repositoryNode);
    owners.set(node, repositoryNode);
    result.nodes.push(repositoryNode);
  };
  const visitDeclarations = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings: { local: string; imported: string }[] = [];
      if (node.importClause?.name) bindings.push({ local: node.importClause.name.text, imported: "default" });
      const named = node.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const item of named.elements) bindings.push({ local: item.name.text, imported: item.propertyName?.text ?? item.name.text });
      if (named && ts.isNamespaceImport(named)) bindings.push({ local: named.name.text, imported: "*" });
      const repositoryNode = makeNode(source, "import", node.moduleSpecifier.text, offset + node.getStart(sourceFile), offset + node.end, { specifier: node.moduleSpecifier.text, bindings }, `import:${offset + node.pos}:${node.moduleSpecifier.text}`);
      result.nodes.push(repositoryNode);
      for (const binding of bindings) importBindings.set(binding.local, { node: repositoryNode, imported: binding.imported });
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) addDeclaration(node, node.name, ts.SyntaxKind[node.kind]);
    else if ((ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) addDeclaration(node, node.name, ts.SyntaxKind[node.kind]);
    ts.forEachChild(node, visitDeclarations);
  };
  visitDeclarations(sourceFile);
  const ownerOf = (node: ts.Node): RepositoryNode | undefined => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) if (owners.has(current)) return owners.get(current);
    return undefined;
  };
  const literal = (node: ts.Node | undefined) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const target = symbol ? declarations.get(symbol) : undefined;
      const parent = node.parent;
      const declarationName = (ts.isDeclarationStatement(parent) || ts.isVariableDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent)) && "name" in parent && parent.name === node;
      if (target && !declarationName && !ts.isImportSpecifier(parent) && !ts.isImportClause(parent)) {
        const owner = ownerOf(node);
        const edge = makeEdge(owner ?? makeNode(source, "file", source.path), target, ts.isCallExpression(parent) && parent.expression === node ? "calls" : "references", evidence(source, "resolved", "complete"), { binding: "lexical", offset: offset + node.getStart(sourceFile) });
        result.edges.push(edge);
      }
      const imported = importBindings.get(node.text);
      if (imported && symbol?.declarations?.some((declaration) => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) && !ts.isImportSpecifier(parent) && !ts.isImportClause(parent) && !ts.isNamespaceImport(parent)) {
        const reference = makeNode(source, "import-reference", node.text, offset + node.getStart(sourceFile), offset + node.end, { importId: imported.node.id, imported: imported.imported, owner: ownerOf(node)?.id, call: ts.isCallExpression(parent) && parent.expression === node }, `import-reference:${offset + node.getStart(sourceFile)}`);
        result.nodes.push(reference);
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const functionName = expression.getText(sourceFile);
      const isFetch = ["fetch", "$fetch", "useFetch", "axios"].includes(functionName);
      const methodMatch = /(?:axios|http|client|api)\.(get|post|put|patch|delete|head|options)$/i.exec(functionName);
      if (isFetch || methodMatch) {
        const url = literal(node.arguments[0]);
        let method = methodMatch?.[1].toUpperCase() ?? "GET";
        const config = node.arguments[1];
        if (config && ts.isObjectLiteralExpression(config)) for (const property of config.properties) if (ts.isPropertyAssignment(property) && property.name.getText(sourceFile).replace(/["']/g, "") === "method") method = literal(property.initializer)?.toUpperCase() ?? "UNKNOWN";
        const path = url ? staticHttpPath(url) : undefined;
        const call = makeNode(source, "http-call", `${method} ${path ?? "<dynamic>"}`, offset + node.getStart(sourceFile), offset + node.end, { method, path, ...(url?.startsWith("http") ? { origin: (() => { try { return new URL(url).origin; } catch { return undefined; } })() } : {}) }, `http:${offset + node.pos}`);
        result.nodes.push(call);
        const owner = ownerOf(node); if (owner) result.edges.push(makeEdge(owner, call, "calls", evidence(source)));
        if (!path) result.diagnostics.push({ code: "REPOSITORY_DYNAMIC_URL", severity: "info", file: source.path, message: "HTTP URL cannot be statically resolved" });
      }
      if (ts.isPropertyAccessExpression(expression) && /^(?:app|router)\.(get|post|put|patch|delete|head|options)$/.test(functionName)) {
        const path = literal(node.arguments[0]);
        if (path) result.nodes.push(makeNode(source, "endpoint", `${expression.name.text.toUpperCase()} ${path}`, offset + node.getStart(sourceFile), offset + node.end, { method: expression.name.text.toUpperCase(), path }, `endpoint:${offset + node.pos}`));
      }
      if (["test", "it", "describe"].includes(functionName)) {
        const name = literal(node.arguments[0]);
        if (name) result.nodes.push(makeNode(source, "test", name, offset + node.getStart(sourceFile), offset + node.end, { framework: "jest-compatible", observedCoverage: false }, `test:${offset + node.pos}`));
      }
      if (["defineProps", "defineEmits", "defineStore"].includes(functionName)) {
        const names: string[] = [];
        for (const type of node.typeArguments ?? []) if (ts.isTypeLiteralNode(type)) for (const member of type.members) if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) names.push(member.name.text);
        const argument = node.arguments[0];
        if (argument && ts.isArrayLiteralExpression(argument)) for (const item of argument.elements) { const name = literal(item); if (name) names.push(name); }
        if (argument && ts.isObjectLiteralExpression(argument)) for (const property of argument.properties) if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) names.push(property.name.text);
        result.nodes.push(makeNode(source, functionName === "defineStore" ? "store" : "declaration", functionName, offset + node.getStart(sourceFile), offset + node.end, { macro: functionName, names: [...new Set(names)] }, `macro:${offset + node.pos}`));
      }
    }
    // Static Vue Router route entries; no evaluation of arbitrary JS configuration.
    if (ts.isObjectLiteralExpression(node)) {
      let route: string | undefined; let componentName: string | undefined;
      for (const property of node.properties) if (ts.isPropertyAssignment(property)) {
        if (property.name.getText(sourceFile) === "path") route = literal(property.initializer);
        if (property.name.getText(sourceFile) === "component" && ts.isIdentifier(property.initializer)) componentName = property.initializer.text;
      }
      if (route && componentName) {
        const page = makeNode(source, "page", route, offset + node.getStart(sourceFile), offset + node.end, { route, componentName }, `route:${offset + node.pos}`);
        result.nodes.push(page);
        const imported = importBindings.get(componentName); if (imported) result.edges.push(makeEdge(page, imported.node, "routes-to", evidence(source)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  result.limitations.push("TypeScript: lexical bindings are resolved; package types, dynamic imports/configuration and full cross-file type semantics are not resolved");
  return result;
}
