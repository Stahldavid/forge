import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type {
  CairActionScriptHeader,
  CairActionVerb,
  CairParsedAction,
} from "./types.ts";

export interface CairParsedActionScript {
  header?: CairActionScriptHeader;
  blocks: string[];
  diagnostics: Diagnostic[];
}

function actionError(message: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_CAIR_ACTION",
    message,
  });
}

function tokenizeHead(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      if (char === "n") {
        current += "\n";
      } else if (char === "t") {
        current += "\t";
      } else {
        current += char;
      }
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
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function splitBody(raw: string): { head: string; body?: string } {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");
  const markerIndex = lines.findIndex((line) => line.trim().startsWith("<<"));
  if (markerIndex === -1) {
    return { head: normalized };
  }

  const marker = lines[markerIndex]?.trim().slice(2).trim() || "CODE";
  const endIndex = lines.findIndex((line, index) =>
    index > markerIndex && line.trim() === marker,
  );
  if (endIndex === -1) {
    return { head: normalized };
  }

  return {
    head: lines.slice(0, markerIndex).join(" ").trim(),
    body: lines.slice(markerIndex + 1, endIndex).join("\n"),
  };
}

function parseKeyValues(parts: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  const keyAliases: Record<string, string> = {
    f: "file",
    h: "hash",
    k: "kind",
    n: "name",
    nn: "newname",
    p: "path",
    s: "symbol",
    t: "target",
    to: "to",
  };
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const rawKey = part.slice(0, index).toLowerCase();
    args[keyAliases[rawKey] ?? rawKey] = part.slice(index + 1);
  }
  return args;
}

function normalizeVerb(phase: "A" | "V", value: string | undefined): CairActionVerb | null {
  const raw = phase === "V" ? `VERIFY.${value ?? ""}` : value;
  const upper = raw?.toUpperCase();
  switch (upper) {
    case "CF":
    case "CREATE.FILE":
    case "FILE.CREATE":
    case "NEW.FILE":
    case "F+":
      return "CREATE.FILE";
    case "CS":
    case "CREATE.SYMBOL":
    case "SYMBOL.CREATE":
    case "SYM+":
      return "CREATE.SYMBOL";
    case "P":
    case "PATCH":
      return "PATCH";
    case "ADD.EXPORT":
    case "EXPORT.ADD":
    case "EX+":
      return "ADD.EXPORT";
    case "ADD.IMPORT":
    case "IMPORT.ADD":
    case "IM+":
      return "ADD.IMPORT";
    case "APPLY":
    case "AP":
      return "APPLY";
    case "ROLLBACK":
    case "RB":
      return "ROLLBACK";
    case "RN":
    case "RENAME.SYMBOL":
    case "SYMBOL.RENAME":
      return "RENAME.SYMBOL";
    case "MV":
    case "MOVE.SYMBOL":
    case "SYMBOL.MOVE":
      return "MOVE.SYMBOL";
    case "SIG":
    case "UPDATE.SIGNATURE":
    case "SIGNATURE.UPDATE":
      return "UPDATE.SIGNATURE";
    case "PARAM":
    case "ADD.PARAM":
    case "PARAM.ADD":
      return "ADD.PARAM";
    case "CALLS":
    case "UPDATE.CALLSITES":
    case "CALLSITES.UPDATE":
      return "UPDATE.CALLSITES";
    case "OI":
    case "ORGANIZE.IMPORTS":
    case "IMPORTS.ORGANIZE":
      return "ORGANIZE.IMPORTS";
    case "FMT":
    case "FORMAT":
      return "FORMAT";
    case "FP":
    case "FIND.PATTERN":
    case "PATTERN.FIND":
      return "FIND.PATTERN";
    case "RW":
    case "REWRITE.PATTERN":
    case "PATTERN.REWRITE":
      return "REWRITE.PATTERN";
    case "MC":
    case "MAKE.COMMAND":
      return "MAKE.COMMAND";
    case "MQ":
    case "MAKE.QUERY":
      return "MAKE.QUERY";
    case "MA":
    case "MAKE.ACTION":
      return "MAKE.ACTION";
    case "MT":
    case "MAKE.TABLE":
      return "MAKE.TABLE";
    case "AT":
    case "ADD.TEST":
    case "TEST.ADD":
      return "ADD.TEST";
    case "WX":
    case "WIRE.EXPORT":
    case "EXPORT.WIRE":
      return "WIRE.EXPORT";
    case "VERIFY":
    case "VERIFY.TYPECHECK":
    case "TYPECHECK":
    case "VERIFY.TEST":
    case "TEST":
    case "VERIFY.IMPACT":
    case "IMPACT":
      return "VERIFY";
    default:
      return null;
  }
}

function parseHeaderLine(line: string): CairActionScriptHeader | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("@cair")) {
    return null;
  }
  const parts = tokenizeHead(trimmed);
  const args = parseKeyValues(parts.slice(2));
  return {
    ...(parts[1] ? { schemaVersion: parts[1] } : {}),
    ...(args.snapshot ? { snapshot: args.snapshot } : {}),
  };
}

export function parseCairAction(raw: string): { action?: CairParsedAction; diagnostics: Diagnostic[] } {
  const { head, body } = splitBody(raw);
  const parts = tokenizeHead(head);
  const phase = parts[0]?.toUpperCase();
  if (phase !== "A" && phase !== "V") {
    return { diagnostics: [actionError("CAIR action must start with A or V")] };
  }
  const verb = normalizeVerb(phase, parts[1]);
  if (!verb) {
    return { diagnostics: [actionError(`unknown CAIR action verb '${parts[1] ?? ""}'`)] };
  }
  return {
    action: {
      raw: raw.trim(),
      phase,
      verb,
      args: parseKeyValues(parts.slice(2)),
      ...(body !== undefined ? { body } : {}),
    },
    diagnostics: [],
  };
}

export function parseCairActionScript(script: string): CairParsedActionScript {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let hereDocMarker: string | null = null;
  let header: CairActionScriptHeader | undefined;
  const diagnostics: Diagnostic[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!hereDocMarker && current.length === 0 && !header) {
      const parsedHeader = parseHeaderLine(trimmed);
      if (parsedHeader) {
        header = parsedHeader;
        continue;
      }
    }

    if (hereDocMarker) {
      current.push(line);
      if (trimmed === hereDocMarker) {
        hereDocMarker = null;
      }
      continue;
    }

    if (trimmed.startsWith("<<")) {
      current.push(line);
      hereDocMarker = trimmed.slice(2).trim() || "CODE";
      continue;
    }

    if (/^[AV]\s+/.test(trimmed)) {
      if (current.join("\n").trim()) {
        blocks.push(current.join("\n").trim());
      }
      current = [line];
      continue;
    }

    if (current.length > 0 || trimmed) {
      current.push(line);
    }
  }

  if (hereDocMarker) {
    diagnostics.push(actionError(`unterminated CAIR heredoc '${hereDocMarker}'`));
  }
  if (current.join("\n").trim()) {
    blocks.push(current.join("\n").trim());
  }
  return { ...(header ? { header } : {}), blocks, diagnostics };
}

export function splitCairActionScript(script: string): string[] {
  return parseCairActionScript(script).blocks;
}
