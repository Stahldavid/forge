import { basename } from "node:path";
import type { AdapterResult, AnalysisSource, RepositoryNode } from "../types.ts";
import { emptyResult, evidence, makeEdge, makeNode, maskComments, maskLiterals } from "./common.ts";

interface JavaToken { text: string; start: number; end: number; depth: number }

/** Conservative lexical Java grammar. No classpath/build/annotation processors are invoked. */
function tokenizeJava(text: string): JavaToken[] {
  const clean = maskLiterals(maskComments(text));
  const tokens: JavaToken[] = [];
  let depth = 0;
  for (const match of clean.matchAll(/[A-Za-z_$][\w$]*|[^\s]/g)) {
    if (match[0] === "}") depth--;
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length, depth });
    if (match[0] === "{") depth++;
  }
  return tokens;
}

function mappingPaths(args: string): string[] {
  const selected = /(?:value|path)\s*=\s*(\{[^}]*\}|"(?:\\.|[^"\\])*")/.exec(args)?.[1] ?? /^\s*(\{[^}]*\}|"(?:\\.|[^"\\])*")/.exec(args)?.[1];
  if (!selected) return [""];
  return [...selected.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]);
}

function javaAnnotations(prefix: string): { name: string; args: string }[] {
  return [...prefix.matchAll(/@(?:[\w.]+\.)?(\w+)(?:\s*\(([^)]*)\))?/g)].map((match) => ({ name: match[1], args: match[2] ?? "" }));
}

export function analyzeJava(source: AnalysisSource): AdapterResult {
  const result = emptyResult();
  const clean = maskComments(source.text);
  const tokens = tokenizeJava(source.text);
  const packageName = /\bpackage\s+([\w.]+)\s*;/.exec(clean)?.[1] ?? "";
  for (const match of clean.matchAll(/\bimport\s+(?:static\s+)?([\w.*]+)\s*;/g)) result.nodes.push(makeNode(source, "java-import", match[1], match.index, match.index + match[0].length, { qualifiedName: match[1] }, `import:${match[1]}`));
  const classes: { node: RepositoryNode; open: number; close: number; depth: number; mappings: string[] }[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!["class", "interface", "enum", "record"].includes(tokens[i].text) || !/^[A-Za-z_$]/.test(tokens[i + 1].text) || tokens[i - 1]?.text === ".") continue;
    let open = i + 2; while (open < tokens.length && !["{", ";"].includes(tokens[open].text)) open++;
    if (tokens[open]?.text !== "{") continue;
    let close = open + 1; while (close < tokens.length && !(tokens[close].text === "}" && tokens[close].depth === tokens[open].depth)) close++;
    const name = tokens[i + 1].text;
    const qualifiedName = [packageName, name].filter(Boolean).join(".");
    const node = makeNode(source, "symbol", name, tokens[i].start, tokens[close]?.end ?? source.text.length, { symbolKind: tokens[i].text, qualifiedName, package: packageName }, qualifiedName);
    result.nodes.push(node);
    const prefixStart = Math.max(clean.lastIndexOf("}", tokens[i].start - 1), clean.lastIndexOf(";", tokens[i].start - 1)) + 1;
    const annotations = javaAnnotations(clean.slice(prefixStart, tokens[i].start));
    const requestMapping = annotations.find((annotation) => annotation.name === "RequestMapping");
    classes.push({ node, open, close, depth: tokens[open].depth + 1, mappings: requestMapping ? mappingPaths(requestMapping.args) : [""] });
  }
  for (const clazz of classes) {
    let priorBoundary = tokens[clazz.open].end;
    for (let i = clazz.open + 1; i < clazz.close - 1; i++) {
      const token = tokens[i];
      if (token.depth !== clazz.depth) continue;
      if ([";", "}"].includes(token.text)) { priorBoundary = token.end; continue; }
      if (!/^[A-Za-z_$][\w$]*$/.test(token.text) || tokens[i + 1].text !== "(" || ["if", "for", "while", "switch", "catch", "new", "return", "throw", "synchronized"].includes(token.text) || [".", "@", "="].includes(tokens[i - 1]?.text)) continue;
      let endArgs = i + 2; let parentheses = 1;
      while (endArgs < clazz.close && parentheses) { if (tokens[endArgs].text === "(") parentheses++; if (tokens[endArgs].text === ")") parentheses--; if (parentheses) endArgs++; }
      if (parentheses) continue;
      let body = endArgs + 1;
      if (tokens[body]?.text === "throws") while (body < clazz.close && !["{", ";"].includes(tokens[body].text)) body++;
      if (!["{", ";"].includes(tokens[body]?.text)) continue;
      const prefix = clean.slice(priorBoundary, token.start);
      // Annotation invocation is not a method declaration; neither is a field initializer call.
      if (/=/.test(maskLiterals(prefix).replace(/@\w+\([^)]*\)/g, "")) || !/[\w>\]]\s+$/.test(prefix) && token.text !== clazz.node.name) continue;
      let end = body;
      if (tokens[body].text === "{") {
        end = body + 1;
        while (end < clazz.close && !(tokens[end].text === "}" && tokens[end].depth === token.depth)) end++;
      }
      const signature = clean.slice(tokens[i + 1].start, tokens[endArgs].end).replace(/\s+/g, " ");
      const qualifiedName = `${clazz.node.metadata.qualifiedName}.${token.text}${signature}`;
      const method = makeNode(source, "symbol", token.text, priorBoundary, tokens[end]?.end ?? token.end, { symbolKind: "method", qualifiedName, javaClass: clazz.node.metadata.qualifiedName, signature }, qualifiedName);
      result.nodes.push(method); result.edges.push(makeEdge(clazz.node, method, "contains", evidence(source)));
      const annotations = javaAnnotations(prefix);
      if (annotations.some((annotation) => ["Test", "ParameterizedTest", "RepeatedTest", "TestFactory"].includes(annotation.name))) {
        const test = makeNode(source, "test", `${clazz.node.name}.${token.text}`, token.start, tokens[end]?.end ?? token.end, { framework: "junit-or-testng", observedCoverage: false }, `test:${qualifiedName}`);
        result.nodes.push(test); result.edges.push(makeEdge(test, method, "tests", evidence(source)));
      }
      for (const annotation of annotations) {
        const simpleMethod = /^(Get|Post|Put|Patch|Delete|Head|Options)Mapping$/.exec(annotation.name)?.[1].toUpperCase();
        if (!simpleMethod && annotation.name !== "RequestMapping") continue;
        const methods = simpleMethod ? [simpleMethod] : [...annotation.args.matchAll(/RequestMethod\.(\w+)/g)].map((match) => match[1]);
        if (!methods.length) methods.push("ANY");
        for (const base of clazz.mappings) for (const path of mappingPaths(annotation.args)) for (const httpMethod of methods) {
          const joined = `/${`${base}/${path}`.split("/").filter(Boolean).join("/")}`;
          const endpoint = makeNode(source, "endpoint", `${httpMethod} ${joined}`, priorBoundary, token.end, { method: httpMethod, path: joined, handler: method.id, framework: "spring" }, `endpoint:${qualifiedName}:${httpMethod}:${joined}`);
          result.nodes.push(endpoint); result.edges.push(makeEdge(endpoint, method, "calls", evidence(source)));
        }
      }
      // Only lexical occurrences inside a method body; comments/strings cannot become references.
      for (let t = body + 1; t < end; t++) if (/^[A-Za-z_$]/.test(tokens[t].text) && tokens[t + 1]?.text === "(") {
        result.nodes.push(makeNode(source, "java-call", tokens[t].text, tokens[t].start, tokens[t + 1].end, { owner: method.id, qualifier: tokens[t - 1]?.text === "." ? tokens[t - 2]?.text : undefined }, `${qualifiedName}:${tokens[t].start}`));
      }
      priorBoundary = tokens[end]?.end ?? token.end;
      i = end;
    }
  }
  if (!classes.length) result.diagnostics.push({ code: "REPOSITORY_JAVA_NO_DECLARATION", severity: "warning", file: source.path, message: "No supported Java class/interface/record declaration found" });
  if (/\b(?:Class\.forName|reflect|lombok)\b|@(?:Data|Getter|Setter|Builder)\b/.test(clean)) result.diagnostics.push({ code: "REPOSITORY_JAVA_DYNAMIC_FEATURE", severity: "info", file: source.path, message: "Reflection/Lombok/generated members are not statically expanded" });
  result.limitations.push("Java: conservative lexical declaration/annotation analysis; no classpath, overload, reflection, dependency injection, Lombok or semantic call resolution; no build executed");
  return result;
}

export function analyzeJavaBuild(source: AnalysisSource): AdapterResult {
  const result = emptyResult();
  const maven = basename(source.path) === "pom.xml";
  const project = makeNode(source, "package", source.component, 0, 0, { ecosystem: maven ? "maven" : "gradle" });
  project.evidence = evidence(source, "declared"); result.nodes.push(project);
  if (maven) {
    const clean = source.text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, " "));
    for (const match of clean.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g)) {
      const group = /<groupId>([^<]+)<\/groupId>/.exec(match[1])?.[1];
      const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(match[1])?.[1];
      if (group && artifact) {
        const dependency = makeNode(source, "dependency", `${group}:${artifact}`, match.index, match.index + match[0].length, { ecosystem: "maven", version: /<version>([^<]+)<\/version>/.exec(match[1])?.[1] });
        dependency.evidence = evidence(source, "declared"); result.nodes.push(dependency); result.edges.push(makeEdge(project, dependency, "depends-on", evidence(source, "declared")));
      }
    }
    for (const match of clean.matchAll(/<module>([^<]+)<\/module>/g)) result.nodes.push(makeNode(source, "module-declaration", match[1], match.index, match.index + match[0].length, { ecosystem: "maven", root: match[1] }));
    result.limitations.push("Maven: declared XML modules/dependencies only; profiles, inheritance, property substitution and effective POM are not evaluated");
  } else {
    const clean = maskComments(source.text);
    for (const match of clean.matchAll(/\b(?:implementation|api|testImplementation|compileOnly|runtimeOnly)\s*\(?\s*["']([^"']+)["']/g)) {
      const dependency = makeNode(source, "dependency", match[1], match.index, match.index + match[0].length, { ecosystem: "gradle" });
      dependency.evidence = evidence(source, "declared"); result.nodes.push(dependency); result.edges.push(makeEdge(project, dependency, "depends-on", evidence(source, "declared")));
    }
    for (const match of clean.matchAll(/\binclude\s*\(?\s*([^\n)]+)/g)) for (const module of match[1].matchAll(/["']([^"']+)["']/g)) result.nodes.push(makeNode(source, "module-declaration", module[1], match.index, match.index + match[0].length, { ecosystem: "gradle", root: module[1].replace(/^:/, "").replace(/:/g, "/") }));
    result.limitations.push("Gradle: literal dependency/module declarations only; executable DSL, source sets, plugins and computed settings are not evaluated");
  }
  return result;
}
