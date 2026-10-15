export interface BunAuditExecution {
  status: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  error?: { code?: string; message?: string };
}
export interface BunAuditReport {
  schema: string;
  threshold: "high";
  ok: boolean;
  toolExitCode: number | null;
  advisories: Record<string, unknown[]> | null;
  severityCounts: Record<"info" | "low" | "moderate" | "high" | "critical", number>;
  error?: string;
  rawOutput?: string;
  stderr?: string;
}
export function evaluateBunAudit(result: BunAuditExecution): BunAuditReport;
export function runBunAudit(spawn?: (command: string, args: string[], options: {
  encoding: "utf8"; timeout: number; maxBuffer: number; windowsHide: boolean;
}) => BunAuditExecution): BunAuditReport;
