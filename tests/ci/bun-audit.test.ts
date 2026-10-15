import { describe, expect, test } from "bun:test";
import { evaluateBunAudit, runBunAudit } from "../../scripts/audit-bun-lock.mjs";

const result = (data: unknown, status = 1, extra = {}) => ({ status, signal: null, stdout: JSON.stringify(data), stderr: "", ...extra });

describe("Bun lock audit high threshold", () => {
  for (const severity of ["high", "critical"]) test(`blocks ${severity}`, () => {
    const report = evaluateBunAudit(result({ pkg: [{ severity, id: "kept-in-evidence" }] }));
    expect(report.ok).toBe(false);
    expect(report.advisories).toEqual({ pkg: [{ severity, id: "kept-in-evidence" }] });
  });
  for (const severity of ["moderate", "low", "info"]) test(`retains ${severity} without raising the existing threshold`, () => {
    const data = { pkg: [{ severity, id: "retained", details: { full: true } }] };
    const report = evaluateBunAudit(result(data));
    expect(report.ok).toBe(true);
    expect(report.advisories).toEqual(data);
  });
  test("a banner is accepted but child network diagnostics invalidate partial JSON", () => {
    const data = { pkg: [{ severity: "moderate", id: "retained" }] };
    expect(evaluateBunAudit(result(data, 1, { stderr: "bun audit v1.3.14 (0d9b296a)\n" })).ok).toBe(true);
    const partial = evaluateBunAudit(result(data, 1, { stderr: "bun audit v1.3.14 (0d9b296a)\nerror: fetch failed (ECONNRESET)" }));
    expect(partial.ok).toBe(false);
    expect(partial.advisories).toEqual(data);
    expect(partial.error).toContain("completeness");
    expect(evaluateBunAudit(result({}, 0, { stderr: "unknown diagnostic" })).ok).toBe(false);
  });
  test("empty success passes, empty failure fails", () => {
    expect(evaluateBunAudit(result({}, 0)).ok).toBe(true);
    expect(evaluateBunAudit(result({}, 1)).ok).toBe(false);
  });
  for (const data of [null, [], { pkg: {} }, { pkg: [null] }, { pkg: [{}] }, { pkg: [{ severity: "unknown" }] }]) {
    test(`rejects unknown schema ${JSON.stringify(data)}`, () => expect(evaluateBunAudit(result(data)).ok).toBe(false));
  }
  for (const [name, extra] of [
    ["network error", { error: { code: "ENETUNREACH" } }],
    ["timeout", { error: { code: "ETIMEDOUT" } }],
    ["signal", { signal: "SIGTERM" }],
    ["malformed JSON", { stdout: "not JSON" }],
    ["unexpected exit", { status: 2 }],
    ["missing exit", { status: null }],
  ] as const) test(`fails closed on ${name}`, () => expect(evaluateBunAudit(result({}, 0, extra)).ok).toBe(false));
  test("executes an unfiltered audit with a bounded timeout", () => {
    let called = false;
    const report = runBunAudit((command: string, args: string[], options: { timeout: number }) => {
      expect(command).toBe("bun"); expect(args).toEqual(["audit", "--json"]); expect(options.timeout).toBe(120000);
      called = true; return result({}, 0);
    });
    expect(called).toBe(true); expect(report.ok).toBe(true);
  });
});
