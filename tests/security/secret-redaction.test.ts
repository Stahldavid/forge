import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_SECRET_DIRECT_PROCESS_ENV,
  FORGE_TELEMETRY_SECRET_REDACTED,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { checkDirectProcessEnvUsage } from "../../src/forge/compiler/guards/check-process-env.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { scrubEnvelopePayload } from "../../src/forge/runtime/telemetry/scrubber.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

const CANARY = "sk_test_forge_canary_do_not_emit_123";

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

describe("security assurance: secret redaction", () => {
  test("generated artifacts and AGENTS.md do not contain secret canary values", async () => {
    const workspace = scaffoldGenerateWorkspace("security-secret-canary");
    writeFileSync(
      join(workspace, ".env.local"),
      `OPENAI_API_KEY=${CANARY}\n`,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const scannedFiles = [
        join(workspace, "AGENTS.md"),
        ...walkFiles(join(workspace, "src", "forge", "_generated")),
      ];
      const leaked = scannedFiles.filter((file) =>
        readFileSync(file, "utf8").includes(CANARY),
      );
      expect(leaked).toEqual([]);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("telemetry scrubber removes nested secret canary values", () => {
    const { diagnostics, value } = scrubEnvelopePayload({
      schemaVersion: "0.1",
      type: "event",
      traceId: "security-redaction",
      environment: "test",
      runtime: { kind: "action" },
      createdAt: new Date().toISOString(),
      event: {
        name: "forge.security.canary",
        properties: {
          nested: {
            apiKey: CANARY,
            authorization: `Bearer ${CANARY}`,
          },
          safe: "visible",
        },
      },
    });

    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("visible");
    expect(diagnostics.some((diagnostic) => diagnostic.code === FORGE_TELEMETRY_SECRET_REDACTED)).toBe(true);
  });

  test("telemetry scrubber removes known secret values from safe-looking fields", () => {
    const { diagnostics, value } = scrubEnvelopePayload(
      {
        schemaVersion: "0.1",
        type: "exception",
        traceId: "security-value-redaction",
        environment: "test",
        runtime: { kind: "action" },
        createdAt: new Date().toISOString(),
        message: `provider returned ${CANARY}`,
        details: {
          output: `nested ${CANARY} value`,
        },
        exception: {
          name: "Error",
          message: "failure",
          stack: `Error: ${CANARY}\n    at handler`,
        },
      },
      { secretValues: [CANARY] },
    );

    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).toContain("[REDACTED]");
    expect(diagnostics.some((diagnostic) => diagnostic.code === FORGE_TELEMETRY_SECRET_REDACTED)).toBe(true);
  });

  test("direct process.env secret access is reported as a security diagnostic", async () => {
    const workspace = scaffoldGenerateWorkspace("security-process-env");
    mkdirSync(join(workspace, "src", "actions"), { recursive: true });
    writeFileSync(
      join(workspace, "src", "actions", "badEnv.ts"),
      `
        export const leaked = process.env.OPENAI_API_KEY;
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);
      const diagnostics = checkDirectProcessEnvUsage(
        workspace,
        {
          secrets: [
            {
              allowedContexts: ["action"],
              name: "OPENAI_API_KEY",
              required: true,
              source: "manual",
            },
          ],
        } as never,
        true,
      );
      expect(diagnostics.some((diagnostic) => diagnostic.code === FORGE_SECRET_DIRECT_PROCESS_ENV)).toBe(true);
      expect(diagnostics.find((diagnostic) => diagnostic.code === FORGE_SECRET_DIRECT_PROCESS_ENV)?.severity).toBe("error");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
