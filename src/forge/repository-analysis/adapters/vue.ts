import { parse, compileTemplate } from "@vue/compiler-sfc";
import { basename } from "node:path";
import type { AdapterResult, AnalysisSource } from "../types.ts";
import { emptyResult, evidence, makeEdge, makeNode } from "./common.ts";
import { analyzeTypeScript } from "./typescript.ts";

interface TemplateNode {
  type: number;
  tag?: string;
  children?: TemplateNode[];
  branches?: TemplateNode[];
  props?: { type: number; name: string; arg?: { content?: string }; exp?: { content?: string }; loc?: { start: { offset: number }; end: { offset: number } } }[];
  loc?: { start: { offset: number }; end: { offset: number } };
}

export function analyzeVue(source: AnalysisSource): AdapterResult {
  const result = emptyResult();
  const parsed = parse(source.text, { filename: source.path });
  for (const error of parsed.errors) result.diagnostics.push({ code: "REPOSITORY_VUE_PARSE", severity: "error", file: source.path, message: typeof error === "string" ? error : error.message });
  const descriptor = parsed.descriptor;
  const ui = makeNode(source, "ui-component", basename(source.path, ".vue"), 0, source.text.length, { framework: "vue" });
  result.nodes.push(ui);
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    if (block.src) {
      result.nodes.push(makeNode(source, "import", block.src, block.loc.start.offset, block.loc.end.offset, { specifier: block.src, bindings: [] }, `external-script:${block.src}`));
      continue;
    }
    if (block.lang && !["ts", "tsx", "js", "jsx"].includes(block.lang)) {
      result.diagnostics.push({ code: "REPOSITORY_VUE_SCRIPT_LANGUAGE", severity: "warning", file: source.path, message: `Unsupported script language: ${block.lang}` }); continue;
    }
    const analyzed = analyzeTypeScript(source, block.content, block.loc.start.offset, block.lang ?? "js");
    result.nodes.push(...analyzed.nodes); result.edges.push(...analyzed.edges);
    result.diagnostics.push(...analyzed.diagnostics); result.limitations.push(...analyzed.limitations);
    for (const node of analyzed.nodes.filter((node) => ["symbol", "http-call", "store", "declaration"].includes(node.kind))) result.edges.push(makeEdge(ui, node, "contains", evidence(source)));
  }
  if (descriptor.template) {
    const block = descriptor.template;
    if (block.src) result.diagnostics.push({ code: "REPOSITORY_VUE_TEMPLATE_EXTERNAL", severity: "warning", file: source.path, message: "External template src is declared but not loaded or preprocessed by static SFC analysis" });
    else if (block.lang && block.lang !== "html") result.diagnostics.push({ code: "REPOSITORY_VUE_TEMPLATE_LANGUAGE", severity: "warning", file: source.path, message: `Unsupported template preprocessor: ${block.lang}` });
    else {
      const compiled = compileTemplate({ source: block.content, filename: source.path, id: source.hash });
      for (const error of compiled.errors) result.diagnostics.push({ code: "REPOSITORY_VUE_TEMPLATE_PARSE", severity: "error", file: source.path, message: typeof error === "string" ? error : error.message });
      const visit = (node: TemplateNode) => {
        if (node.type === 1 && node.tag && node.loc) {
          const dynamic = node.tag === "component";
          const importedComponent = result.nodes.find((candidate) => candidate.kind === "import" && Array.isArray(candidate.metadata.bindings) && (candidate.metadata.bindings as { local: string }[]).some((binding) => binding.local === node.tag || binding.local.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() === node.tag));
          if (importedComponent) {
            const edge = makeEdge(ui, importedComponent, "renders", evidence(source));
            result.edges.push(edge);
          } else if (/^[A-Z]/.test(node.tag) || node.tag.includes("-") || dynamic) {
            const unresolved = makeNode(source, "ui-reference", node.tag, block.loc.start.offset + node.loc.start.offset, block.loc.start.offset + node.loc.end.offset, { dynamic, autoimport: !dynamic, resolved: false }, `template:${node.loc.start.offset}`);
            result.nodes.push(unresolved); result.edges.push(makeEdge(ui, unresolved, "renders", evidence(source, "syntactic", "unresolved")));
            result.diagnostics.push({ code: "REPOSITORY_VUE_COMPONENT_UNRESOLVED", severity: "info", file: source.path, message: `Component '${node.tag}' has no explicit resolved import; autoimports/dynamic components remain unresolved` });
          }
        }
        for (const child of node.children ?? []) visit(child);
        for (const branch of node.branches ?? []) visit(branch);
      };
      if (compiled.ast) visit(compiled.ast as unknown as TemplateNode);
    }
  }
  const pageMatch = /(?:^|\/)(?:pages|app\/pages)\/(.+)\.vue$/.exec(source.path);
  if (pageMatch) {
    const route = `/${pageMatch[1].replace(/(?:^|\/)index$/, "").replace(/\[([^\]]+)\]/g, ":$1")}`.replace(/\/$/, "") || "/";
    const page = makeNode(source, "page", route, 0, source.text.length, { framework: "nuxt", route, convention: true });
    page.evidence = evidence(source, "inferred"); result.nodes.push(page); result.edges.push(makeEdge(page, ui, "renders", evidence(source, "inferred")));
  }
  result.limitations.push("Vue: explicit imports, SFC blocks and HTML templates parsed; runtime component registration, Nuxt autoimports, template expression type resolution and custom preprocessors remain unresolved");
  return result;
}
