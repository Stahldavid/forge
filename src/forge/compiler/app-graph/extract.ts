import type { SyntaxNode } from "tree-sitter";
import { classifyForgeCallee } from "./classify.ts";
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

  function visit(node: SyntaxNode): void {
    if (node.type === "call_expression") {
      const functionNode = node.childForFieldName("function");
      if (functionNode) {
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
