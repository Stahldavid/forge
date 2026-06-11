export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file?: string;
  span?: { start: number; end: number };
  fixHint?: string;
  suggestedCommands?: string[];
  docs?: string[];
}
