import ts from "typescript";
import type { ExportKind, ExportSignature } from "../types/package-graph.ts";
import { compareExports, stableSortExports } from "../primitives/sort.ts";
import { stubExportClassification } from "./capabilities-stub.ts";
import { extractExamples, extractJsDoc } from "./jsdoc.ts";
import { readTextFile } from "./read-file.ts";
import { createResolutionCompilerOptions } from "./resolve.ts";
import type { ResolutionMode } from "../types/runtime.ts";

export function normalizeSignatureText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDtsSignatures(
  dtsPath: string,
  packageName: string,
  entrypoint: string,
  mode: ResolutionMode,
): ExportSignature[] {
  const options = createResolutionCompilerOptions(mode);
  const program = ts.createProgram([dtsPath], options);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(dtsPath);
  if (source == null) {
    return [];
  }

  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol == null) {
    return [];
  }

  const exportsList = checker.getExportsOfModule(moduleSymbol);
  const results: ExportSignature[] = [];

  for (const sym of exportsList) {
    const decls = sym.declarations ?? [];
    if (decls.length === 0) {
      continue;
    }

    const type = checker.getTypeOfSymbolAtLocation(sym, decls[0]!);
    const callSigs = type.getCallSignatures();
    const printed =
      callSigs.length > 0
        ? callSigs.map((sig) =>
            normalizeSignatureText(checker.signatureToString(sig)),
          )
        : [normalizeSignatureText(checker.typeToString(type))];

    const declarationTexts =
      decls.length > 1
        ? decls.map((decl) =>
            normalizeSignatureText(decl.getText(source).replace(/\s+/g, " ")),
          )
        : undefined;

    const jsdoc = extractJsDoc(sym, checker);
    const exportName = resolveExportName(sym, decls[0]!);

    results.push({
      name: exportName,
      kind: classifyDeclKind(decls[0]!),
      signature: printed[0]!,
      overloads: printed.length > 1 ? printed.slice(1) : undefined,
      declarations: declarationTexts,
      classification: stubExportClassification(
        packageName,
        entrypoint,
        exportName,
      ),
      jsdoc,
      examples: extractExamples(jsdoc),
    });
  }

  return stableSortExports(results);
}

function classifyDeclKind(node: ts.Declaration): ExportKind {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return "function";
  }
  if (ts.isClassDeclaration(node)) {
    return "class";
  }
  if (ts.isInterfaceDeclaration(node)) {
    return "interface";
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return "type";
  }
  if (ts.isModuleDeclaration(node)) {
    return "namespace";
  }
  return "const";
}

function resolveExportName(symbol: ts.Symbol, decl: ts.Declaration): string {
  const symbolName = symbol.getName();
  if (symbolName !== "default") {
    return symbolName;
  }
  if (ts.isClassDeclaration(decl) && decl.name != null) {
    return decl.name.text;
  }
  if (ts.isFunctionDeclaration(decl) && decl.name != null) {
    return decl.name.text;
  }
  if (ts.isInterfaceDeclaration(decl) && decl.name != null) {
    return decl.name.text;
  }
  return symbolName;
}

export function canParseDtsFile(dtsPath: string, mode: ResolutionMode): boolean {
  try {
    readTextFile(dtsPath);
    const exports = extractDtsSignatures(dtsPath, "probe", ".", mode);
    return exports.length >= 0;
  } catch {
    return false;
  }
}

export { compareExports };
