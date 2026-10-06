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
  // Initializer variables (for example `response = await api.get(...)`) are not callables.
  const callableOwnerOf = (node: ts.Node): RepositoryNode | undefined => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) return owners.get(current);
      if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
        let wrapped: ts.Node = current;
        while (wrapped.parent && (ts.isParenthesizedExpression(wrapped.parent) || ts.isAsExpression(wrapped.parent) || ts.isSatisfiesExpression(wrapped.parent))) wrapped = wrapped.parent;
        return ts.isVariableDeclaration(wrapped.parent) && wrapped.parent.initializer === wrapped ? owners.get(wrapped.parent) : undefined;
      }
    }
    return ownerOf(node);
  };
  const literal = (node: ts.Node | undefined) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  type Scalar = string | number | boolean;
  const mutatedObjects = new Set<ts.Symbol>();
  const collectMutations = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const target = node.left;
      if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) { const symbol = checker.getSymbolAtLocation(target.expression); if (symbol) mutatedObjects.add(symbol); }
    }
    ts.forEachChild(node, collectMutations);
  };
  collectMutations(sourceFile);
  const unwrapped = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isAwaitExpression(expression)) expression = expression.expression;
    return expression;
  };
  const constant = (expression: ts.Expression | undefined, parameters = new Map<ts.Symbol, Scalar>(), seen = new Set<ts.Symbol>(), depth = 0): Scalar | undefined => {
    if (!expression || depth > 20) return undefined;
    expression = unwrapped(expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isNumericLiteral(expression)) return Number(expression.text);
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return expression.kind === ts.SyntaxKind.TrueKeyword;
    if (ts.isIdentifier(expression)) {
      if (/(?:password|secret|credential|authorization|token)/i.test(expression.text)) return undefined;
      const symbol = checker.getSymbolAtLocation(expression);
      if (!symbol || seen.has(symbol)) return undefined;
      if (parameters.has(symbol)) return parameters.get(symbol);
      const declaration = symbol.valueDeclaration;
      if (!declaration || !ts.isVariableDeclaration(declaration) || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return undefined;
      const next = new Set(seen); next.add(symbol);
      return constant(declaration.initializer, parameters, next, depth + 1);
    }
    if (ts.isTemplateExpression(expression)) {
      let value = expression.head.text;
      for (const span of expression.templateSpans) { const part = constant(span.expression, parameters, seen, depth + 1); if (part === undefined) return undefined; value += String(part) + span.literal.text; }
      return value;
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constant(expression.left, parameters, seen, depth + 1); const right = constant(expression.right, parameters, seen, depth + 1);
      if (left === undefined || right === undefined) return undefined;
      return typeof left === "number" && typeof right === "number" ? left + right : String(left) + String(right);
    }
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && !/(?:password|secret|credential|authorization|token)/i.test(expression.name.text)) {
      const symbol = checker.getSymbolAtLocation(expression.expression); const declaration = symbol?.valueDeclaration;
      if (symbol && mutatedObjects.has(symbol)) return undefined;
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer && ts.isObjectLiteralExpression(unwrapped(declaration.initializer))) {
        const value = unwrapped(declaration.initializer) as ts.ObjectLiteralExpression;
        const property = value.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText(sourceFile).replace(/["']/g, "") === expression.name.text);
        if (property && ts.isPropertyAssignment(property)) return constant(property.initializer, parameters, seen, depth + 1);
      }
    }
    return undefined;
  };
  const staticString = (expression: ts.Expression | undefined, parameters?: Map<ts.Symbol, Scalar>): string | undefined => { const value = constant(expression, parameters); return value === undefined ? undefined : String(value); };
  const segmentPathPattern = (expression: ts.Expression | undefined): { requestPathPattern: string; requestPatternParameters: { name: string; kind: string }[] } | undefined => {
    if (!expression) return undefined;
    expression = unwrapped(expression);
    if (!ts.isTemplateExpression(expression) || !/^\/(?!\/)/.test(expression.head.text) || expression.templateSpans.length > 8) return undefined;
    let path = expression.head.text;
    const parameters: { name: string; kind: string }[] = [];
    for (const span of expression.templateSpans) {
      if (!path.endsWith("/") || span.literal.text && !span.literal.text.startsWith("/")) return undefined;
      const value = constant(span.expression);
      if (value !== undefined) { if (!/^[A-Za-z0-9_~-]+$/.test(String(value))) return undefined; path += String(value) + span.literal.text; continue; }
      let parameter = unwrapped(span.expression); let encoded = false;
      if (ts.isCallExpression(parameter) && ts.isIdentifier(parameter.expression) && parameter.expression.text === "encodeURIComponent" && !checker.getSymbolAtLocation(parameter.expression) && parameter.arguments.length === 1) { parameter = unwrapped(parameter.arguments[0]); encoded = true; }
      if (!ts.isIdentifier(parameter) || /(?:password|secret|credential|authorization|token)/i.test(parameter.text)) return undefined;
      const declaration = checker.getSymbolAtLocation(parameter)?.valueDeclaration;
      if (!declaration || !ts.isParameter(declaration) || declaration.type?.kind !== ts.SyntaxKind.NumberKeyword && !(encoded && declaration.type?.kind === ts.SyntaxKind.StringKeyword)) return undefined;
      parameters.push({ name: parameter.text, kind: declaration.type?.kind === ts.SyntaxKind.NumberKeyword ? "number" : "encoded-string" });
      path += `{${parameter.text}}${span.literal.text}`;
    }
    if (!parameters.length || path.length > 2048 || /[?#\\%]|\/\//.test(path) || path.split("/").some((segment) => segment === "." || segment === ".." || segment && !/^(?:[A-Za-z0-9_.~-]+|\{[A-Za-z_$][\w$]*\})$/.test(segment))) return undefined;
    return { requestPathPattern: path, requestPatternParameters: parameters };
  };
  const staticObject = (expression: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined => {
    if (!expression) return undefined; expression = unwrapped(expression);
    if (ts.isObjectLiteralExpression(expression)) return expression;
    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression); const declaration = symbol?.valueDeclaration;
      if (symbol && !mutatedObjects.has(symbol) && declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer) { const value = unwrapped(declaration.initializer); if (ts.isObjectLiteralExpression(value)) return value; }
    }
    return undefined;
  };
  const propertyValue = (object: ts.Expression | undefined, name: string): ts.Expression | undefined => {
    const value = staticObject(object); if (!value) return undefined;
    for (const item of [...value.properties].reverse()) {
      if (ts.isSpreadAssignment(item)) return undefined;
      if (ts.isPropertyAssignment(item) && item.name.getText(sourceFile).replace(/["']/g, "") === name) return item.initializer;
      if (ts.isShorthandPropertyAssignment(item) && item.name.text === name) return item.name;
    }
    return undefined;
  };
  const urlMetadata = (url: string | undefined, base?: string) => {
    const absolute = url !== undefined && /^(?:https?:)?\/\//.test(url);
    const combined = url === undefined ? undefined : !absolute && base ? `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}` : url;
    const path = combined !== undefined ? staticHttpPath(combined) : undefined;
    let origin: string | undefined;
    if (combined && /^https?:\/\//.test(combined)) { try { origin = new URL(combined).origin; } catch { /* unresolved invalid URL */ } }
    return { path, origin, requestPath: url !== undefined ? staticHttpPath(url) : undefined, requestAbsolute: absolute };
  };
  interface Client { node: RepositoryNode; baseURL?: string; baseKnown: boolean }
  const clients = new Map<ts.Symbol, Client>();
  const builtinName = (expression: ts.Expression): string | undefined => {
    if (!ts.isIdentifier(expression)) return undefined;
    const imported = importBindings.get(expression.text);
    if (imported && ["axios", "ofetch"].includes(imported.node.name)) return imported.node.name === "axios" ? "axios" : "$fetch";
    const symbol = checker.getSymbolAtLocation(expression);
    return !symbol && ["fetch", "$fetch", "useFetch", "axios", "ofetch"].includes(expression.text) ? expression.text : undefined;
  };
  const collectClients = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(unwrapped(node.initializer))) {
      const factory = unwrapped(node.initializer) as ts.CallExpression;
      if (ts.isPropertyAccessExpression(factory.expression) && factory.expression.name.text === "create" && builtinName(factory.expression.expression)) {
        const baseExpression = propertyValue(factory.arguments[0], "baseURL");
        const baseURL = staticString(baseExpression);
        const options = staticObject(factory.arguments[0]);
        const baseKnown = !factory.arguments[0] || !!options && (baseExpression ? baseURL !== undefined : !options.properties.some((property) => ts.isSpreadAssignment(property)));
        const symbol = checker.getSymbolAtLocation(node.name);
        const model = makeNode(source, "http-client", node.name.text, offset + node.getStart(sourceFile), offset + node.end, { clientId: node.name.text, baseKnown, ...urlMetadata("", baseURL), exported: symbol ? declarations.get(symbol)?.metadata.exported : false, factory: builtinName(factory.expression.expression) }, `client:${offset + node.pos}`);
        result.nodes.push(model);
        if (symbol) clients.set(symbol, { node: model, baseURL, baseKnown });
      }
    }
    ts.forEachChild(node, collectClients);
  };
  collectClients(sourceFile);
  interface Request { method: string; url?: string; clientId: string; confidence: string; client?: Client; clientImportId?: string; baseURL?: string; baseKnown: boolean }
  const request = (node: ts.CallExpression, parameters?: Map<ts.Symbol, Scalar>): Request | undefined => {
    const expression = node.expression;
    if (ts.isPropertyAccessExpression(expression) && /^(get|post|put|patch|delete|head|options)$/i.test(expression.name.text) && ts.isIdentifier(expression.expression)) {
      const receiver = expression.expression;
      const symbol = checker.getSymbolAtLocation(receiver); const client = symbol ? clients.get(symbol) : undefined;
      const imported = importBindings.get(receiver.text);
      const builtin = builtinName(receiver);
      const binding = symbol?.valueDeclaration;
      const declaration = binding && ts.isBindingElement(binding) && ts.isObjectBindingPattern(binding.parent) && ts.isVariableDeclaration(binding.parent.parent) ? binding.parent.parent : undefined;
      const initializer = declaration?.initializer && unwrapped(declaration.initializer);
      const nuxtProvided = initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "useNuxtApp" && !checker.getSymbolAtLocation(initializer.expression);
      if (!client && !imported && !builtin && !nuxtProvided && !/^(?:\$?api|http|client)$/.test(receiver.text)) return undefined;
      const options = node.arguments[["post", "put", "patch"].includes(expression.name.text.toLowerCase()) ? 2 : 1];
      const baseExpression = propertyValue(options, "baseURL"); const baseURL = staticString(baseExpression, parameters) ?? client?.baseURL;
      return { method: expression.name.text.toUpperCase(), url: staticString(node.arguments[0], parameters), clientId: receiver.text, confidence: client ? "factory" : builtin ? "builtin" : "candidate", client, clientImportId: imported?.node.id, baseURL, baseKnown: baseExpression ? staticString(baseExpression, parameters) !== undefined : client?.baseKnown ?? !!builtin };
    }
    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression); const client = symbol ? clients.get(symbol) : undefined;
      const builtin = builtinName(expression);
      if (!client && !builtin) return undefined;
      const options = node.arguments[1];
      const baseExpression = builtin === "fetch" ? undefined : propertyValue(options, "baseURL"); const methodExpression = propertyValue(options, "method");
      const method = methodExpression ? staticString(methodExpression, parameters)?.toUpperCase() ?? "UNKNOWN" : "GET";
      const baseURL = staticString(baseExpression, parameters) ?? client?.baseURL;
      const url = staticString(node.arguments[0], parameters);
      const documentRelative = url !== undefined && !/^(?:\/|https?:\/\/)/.test(url) && !baseURL;
      return { method, url, clientId: expression.text, confidence: client ? "factory" : "builtin", client, baseURL, baseKnown: !documentRelative && (baseExpression ? staticString(baseExpression, parameters) !== undefined : client?.baseKnown ?? true) };
    }
    return undefined;
  };
  const wrappers = new Map<ts.Symbol, { method: string; urlTemplate: string; parameterIndex: number; baseURL?: string; baseKnown: boolean; clientId: string }>();
  const collectWrappers = (node: ts.Node) => {
    let callable: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined; let symbol: ts.Symbol | undefined;
    if (ts.isFunctionDeclaration(node) && node.name) { callable = node; symbol = checker.getSymbolAtLocation(node.name); }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(unwrapped(node.initializer)) || ts.isFunctionExpression(unwrapped(node.initializer)))) { callable = unwrapped(node.initializer) as ts.ArrowFunction | ts.FunctionExpression; symbol = checker.getSymbolAtLocation(node.name); }
    if (callable && symbol && callable.body) {
      const body = callable.body;
      const returns = ts.isBlock(body) ? body.statements.filter((statement): statement is ts.ReturnStatement => ts.isReturnStatement(statement)) : [];
      const returned = ts.isBlock(body) ? returns.length === 1 && body.statements.every((statement) => ts.isReturnStatement(statement) || ts.isVariableStatement(statement)) ? returns[0].expression : undefined : body;
      const expression = returned && unwrapped(returned);
      if (expression && ts.isCallExpression(expression)) {
        const params = new Map<ts.Symbol, Scalar>();
        callable.parameters.forEach((parameter, index) => { if (ts.isIdentifier(parameter.name)) { const bound = checker.getSymbolAtLocation(parameter.name); if (bound) params.set(bound, `__FORGE_URL_PARAM_${index}__`); } });
        const model = request(expression, params);
        const tokens = model?.url?.match(/__FORGE_URL_PARAM_\d+__/g);
        if (model?.url && tokens?.length === 1 && model.confidence !== "candidate" && model.method !== "UNKNOWN") {
          const wrapper = { method: model.method, urlTemplate: model.url, parameterIndex: Number(/\d+/.exec(tokens[0])![0]), baseURL: model.baseURL, baseKnown: model.baseKnown, clientId: model.clientId };
          wrappers.set(symbol, wrapper);
          const safeTemplate = staticHttpPath(model.url);
          const declaration = declarations.get(symbol); if (declaration && safeTemplate?.includes(tokens[0])) declaration.metadata.httpWrapper = { ...wrapper, urlTemplate: safeTemplate, baseURL: undefined, ...urlMetadata("", model.baseURL), origin: urlMetadata(model.url, model.baseURL).origin };
        }
      }
    }
    ts.forEachChild(node, collectWrappers);
  };
  collectWrappers(sourceFile);
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const target = symbol ? declarations.get(symbol) : undefined;
      const parent = node.parent;
      const declarationName = (ts.isDeclarationStatement(parent) || ts.isVariableDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isParameter(parent)) && "name" in parent && parent.name === node;
      if (target && !declarationName && !ts.isImportSpecifier(parent) && !ts.isImportClause(parent)) {
        const owner = ts.isCallExpression(parent) && parent.expression === node ? callableOwnerOf(node) : ownerOf(node);
        const edge = makeEdge(owner ?? makeNode(source, "file", source.path), target, ts.isCallExpression(parent) && parent.expression === node ? "calls" : "references", evidence(source, "resolved", "complete"), { binding: "lexical", offset: offset + node.getStart(sourceFile) });
        result.edges.push(edge);
      }
      const imported = importBindings.get(node.text);
      if (imported && symbol?.declarations?.some((declaration) => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration)) && !ts.isImportSpecifier(parent) && !ts.isImportClause(parent) && !ts.isNamespaceImport(parent)) {
        const invocation = ts.isCallExpression(parent) && parent.expression === node ? parent : imported.imported === "*" && ts.isPropertyAccessExpression(parent) && parent.expression === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent ? parent.parent : undefined;
        const call = !!invocation;
        const argument = invocation ? staticString(invocation.arguments[0]) : undefined;
        const argumentPaths = invocation ? invocation.arguments.map((argument) => { const value = staticString(argument); return value && /^(?:\/|https?:\/\/)/.test(value) ? staticHttpPath(value) : undefined; }) : undefined;
        const reference = makeNode(source, "import-reference", node.text, offset + node.getStart(sourceFile), offset + node.end, { importId: imported.node.id, imported: imported.imported === "*" && ts.isPropertyAccessExpression(parent) ? parent.name.text : imported.imported, namespace: imported.imported === "*", owner: (call ? callableOwnerOf(node) : ownerOf(node))?.id, call, argumentPaths, ...(argument ? { argumentPath: staticHttpPath(argument), argumentAbsolute: /^(?:https?:)?\/\//.test(argument) } : {}) }, `import-reference:${offset + node.getStart(sourceFile)}`);
        result.nodes.push(reference);
      }
      if (!symbol && ts.isCallExpression(parent) && parent.expression === node && !builtinName(node)) {
        const argument = staticString(parent.arguments[0]);
        const argumentPaths = parent.arguments.map((argument) => { const value = staticString(argument); return value && /^(?:\/|https?:\/\/)/.test(value) ? staticHttpPath(value) : undefined; });
        result.nodes.push(makeNode(source, "unresolved-reference", node.text, offset + node.getStart(sourceFile), offset + node.end, { owner: callableOwnerOf(node)?.id, call: true, argumentPaths, ...(argument ? { argumentPath: staticHttpPath(argument), argumentAbsolute: /^(?:https?:)?\/\//.test(argument) } : {}) }, `unresolved-reference:${offset + node.getStart(sourceFile)}`));
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const functionName = expression.getText(sourceFile);
      let model = request(node);
      if (!model && ts.isIdentifier(expression)) {
        const symbol = checker.getSymbolAtLocation(expression); const wrapper = symbol && wrappers.get(symbol);
        const argument = wrapper && staticString(node.arguments[wrapper.parameterIndex]);
        if (wrapper && argument !== undefined) model = { method: wrapper.method, url: wrapper.urlTemplate.replace(`__FORGE_URL_PARAM_${wrapper.parameterIndex}__`, argument), clientId: expression.text, confidence: "wrapper", baseURL: wrapper.baseURL, baseKnown: wrapper.baseKnown };
      }
      if (model) {
        const info = urlMetadata(model.url, model.baseURL);
        const pattern = model.url === undefined ? segmentPathPattern(node.arguments[0]) : undefined;
        const call = makeNode(source, "http-call", `${model.method} ${info.path ?? "<dynamic>"}`, offset + node.getStart(sourceFile), offset + node.end, { method: model.method, ...info, ...pattern, ...(pattern ? { origin: urlMetadata("", model.baseURL).origin } : {}), clientId: model.clientId, clientConfidence: model.confidence, clientModelId: model.client?.node.id, clientImportId: model.clientImportId, baseKnown: model.baseKnown, basePath: model.baseURL ? urlMetadata("", model.baseURL).path : undefined }, `http:${offset + node.pos}`);
        result.nodes.push(call);
        const owner = callableOwnerOf(node); if (owner) result.edges.push(makeEdge(owner, call, "calls", evidence(source)));
        if (!info.path || !model.baseKnown) result.diagnostics.push({ code: "REPOSITORY_DYNAMIC_URL", severity: "info", file: source.path, message: "HTTP URL or client base cannot be statically resolved" });
      }
      if (ts.isPropertyAccessExpression(expression) && /^(?:app|router)\.(get|post|put|patch|delete|head|options)$/.test(functionName)) {
        const path = literal(node.arguments[0]);
        if (path) result.nodes.push(makeNode(source, "endpoint", `${expression.name.text.toUpperCase()} ${path}`, offset + node.getStart(sourceFile), offset + node.end, { method: expression.name.text.toUpperCase(), path }, `endpoint:${offset + node.pos}`));
      }
      if (/^(?:test|it|describe)(?:\.(?:only|skip|todo))?$/.test(functionName)) {
        const name = literal(node.arguments[0]);
        const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
        if (name) result.nodes.push(makeNode(source, functionName.startsWith("describe") ? "test-suite" : "test", name, offset + node.getStart(sourceFile), offset + node.end, { framework: "jest-compatible", observedCoverage: false, ...(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? { testBody: { start: offset + callback.body.getStart(sourceFile), end: offset + callback.body.end } } : {}) }, `test:${offset + node.pos}`));
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
      const provide = propertyValue(node, "provide");
      if (provide && ts.isObjectLiteralExpression(provide)) for (const property of provide.properties) {
        const variable = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer) ? property.initializer : undefined;
        if (!variable || !property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) continue;
        const symbol = ts.isShorthandPropertyAssignment(property) ? checker.getShorthandAssignmentValueSymbol(property) : checker.getSymbolAtLocation(variable);
        const client = symbol && clients.get(symbol);
        if (client) client.node.metadata.providedAs = [...new Set([...(Array.isArray(client.node.metadata.providedAs) ? client.node.metadata.providedAs as string[] : []), `$${property.name.text}`])];
      }
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
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      const symbol = checker.getSymbolAtLocation(node.expression); const declaration = symbol && declarations.get(symbol); const client = symbol && clients.get(symbol);
      if (declaration) { declaration.metadata.defaultExport = true; declaration.metadata.exported = true; }
      if (client) { client.node.metadata.defaultExport = true; client.node.metadata.exported = true; }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  result.limitations.push("TypeScript: lexical bindings are resolved; package types, dynamic imports/configuration and full cross-file type semantics are not resolved");
  return result;
}
