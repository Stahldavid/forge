import { randomBytes } from "node:crypto";

export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function generateRequestId(): string {
  return randomBytes(8).toString("hex");
}
