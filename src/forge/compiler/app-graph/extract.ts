import type { SyntaxNode } from "tree-sitter";
import { classifyForgeCallee } from "./classify.ts";
import type { ForgeKind } from "../types/app-graph.ts";
import type { RawSymbol } from "./types.ts";

export interface SymbolNameInfo {
  name: string;
  qualifiedName: string;
  exportPath: string;
}

export function resolveCalleeName(functionNode: SyntaxNode): string | null {
  if (functionNode.type === "identifier") {
    return functionNode.text;
  }

  if (functionNode.type === "member_expression") {
    const property = functionNode.childForFieldName("property");
    if (property && (property.type === "property_identifier" || property.type === "identifier")) {
      return property.text;
    }
  }

  return null;
}

export function inferSymbolName(callNode: SyntaxNode): SymbolNameInfo {
  let exportPath = "";
  let parent: SyntaxNode | null = callNode.parent;

  while (parent) {
    if (parent.type === "variable_declarator") {
      const nameNode = parent.childForFieldName("name");
      if (nameNode) {
        const name = nameNode.text;
        return { name, qualifiedName: name, exportPath };
      }
    }

    if (parent.type === "lexical_declaration" || parent.type === "variable_declaration") {
      const declarator = parent.namedChildren.find(
        (child) => child.type === "variable_declarator",
      );
      if (declarator) {
        const nameNode = declarator.childForFieldName("name");
        if (nameNode) {
          const name = nameNode.text;
          return { name, qualifiedName: name, exportPath };
        }
      }
    }

    if (parent.type === "export_statement") {
      const declaration = parent.childForFieldName("declaration");
      if (declaration?.type === "lexical_declaration" || declaration?.type === "variable_declaration") {
        const declarator = declaration.namedChildren.find(
          (child) => child.type === "variable_declarator",
        );
        if (declarator) {
          const nameNode = declarator.childForFieldName("name");
          if (nameNode) {
            const name = nameNode.text;
            return { name, qualifiedName: name, exportPath: "" };
          }
        }
      }

      const value = parent.childForFieldName("value");
      if (value === callNode || value?.descendantsOfType("call_expression").includes(callNode)) {
        exportPath = "default";
        const fallback = "__default_export__";
        return { name: fallback, qualifiedName: fallback, exportPath };
      }
    }

    parent = parent.parent;
  }

  const fallback = `__forge_${callNode.startPosition.row}_${callNode.startPosition.column}`;
  return { name: fallback, qualifiedName: fallback, exportPath };
}

export function extractSymbolsFromTree(
  root: SyntaxNode,
  file: string,
  source: string,
): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  const visited = new Set<string>();

  function record(
    kind: ForgeKind,
    name: string,
    qualifiedName: string,
    node: SyntaxNode,
    exportPath: string,
  ): void {
    const key = `${kind}:${qualifiedName}:${node.startIndex}:${node.endIndex}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);
    symbols.push({
      kind,
      name,
      qualifiedName,
      file,
      span: { start: node.startIndex, end: node.endIndex },
      exportPath,
      sourceSlice: source.slice(node.startIndex, node.endIndex),
    });
  }

  function symbolNameForDeclaration(node: SyntaxNode): string | null {
    const nameNode = node.childForFieldName("name");
    if (
      nameNode?.type === "identifier" ||
      nameNode?.type === "type_identifier"
    ) {
      return nameNode.text;
    }
    return null;
  }

  function codeDeclarationKind(node: SyntaxNode): ForgeKind | null {
    if (node.type === "function_declaration") return "code.function";
    if (node.type === "class_declaration") return "code.class";
    if (node.type === "interface_declaration") return "code.interface";
    if (node.type === "type_alias_declaration") return "code.type";
    if (node.type === "enum_declaration") return "code.enum";
    return null;
  }

  function isProgramLevel(node: SyntaxNode): boolean {
    return node.parent?.type === "program" ||
      (node.parent?.type === "export_statement" && node.parent.parent?.type === "program");
  }

  function exportPathForNode(node: SyntaxNode): string {
    return node.parent?.type === "export_statement" ? "export" : "";
  }

  function resolveVariableInitializerCallee(declarator: SyntaxNode): string | null {
    const value = declarator.childForFieldName("value");
    if (value?.type !== "call_expression") {
      return null;
    }
    const functionNode = value.childForFieldName("function");
    return functionNode?.type === "identifier" ? resolveCalleeName(functionNode) : null;
  }

  function recordCodeDeclaration(node: SyntaxNode): void {
    if (!isProgramLevel(node)) {
      return;
    }
    const kind = codeDeclarationKind(node);
    if (!kind) {
      return;
    }
    const name = symbolNameForDeclaration(node);
    if (!name) {
      return;
    }
    record(kind, name, name, node, exportPathForNode(node));
  }

  function recordCodeVariables(node: SyntaxNode): void {
    if (
      node.type !== "lexical_declaration" &&
      node.type !== "variable_declaration"
    ) {
      return;
    }
    if (!isProgramLevel(node)) {
      return;
    }

    for (const declarator of node.namedChildren) {
      if (declarator.type !== "variable_declarator") {
        continue;
      }
      const nameNode = declarator.childForFieldName("name");
      if (nameNode?.type !== "identifier") {
        continue;
      }
      const callee = resolveVariableInitializerCallee(declarator);
      if (callee && classifyForgeCallee(callee)) {
        continue;
      }
      record("code.const", nameNode.text, nameNode.text, declarator, exportPathForNode(node));
    }
  }

  function visit(node: SyntaxNode): void {
    recordCodeDeclaration(node);
    recordCodeVariables(node);

    if (node.type === "call_expression") {
      const functionNode = node.childForFieldName("function");
      if (functionNode && functionNode.type === "identifier") {
        const callee = resolveCalleeName(functionNode);
        if (callee) {
          const kind = classifyForgeCallee(callee);
          if (kind) {
            const key = `${kind}:${node.startIndex}:${node.endIndex}`;
            if (!visited.has(key)) {
              visited.add(key);
              const { name, qualifiedName, exportPath } = inferSymbolName(node);
              symbols.push({
                kind,
                name,
                qualifiedName,
                file,
                span: { start: node.startIndex, end: node.endIndex },
                exportPath,
                sourceSlice: source.slice(node.startIndex, node.endIndex),
              });
            }
          }
        }
      }
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return symbols;
}
