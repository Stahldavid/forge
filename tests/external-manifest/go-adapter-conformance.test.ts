import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { importExternalManifest } from "../../src/forge/compiler/external-manifest/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
} from "../orchestrator/helpers.ts";
import {
  scaffoldClientWorkspace,
  startClientDevServer,
} from "../client/helpers.ts";

const GO_EXAMPLE_DIR = resolve(process.cwd(), "examples", "go-billing");
const GO_ADAPTER_DIR = resolve(process.cwd(), "adapters", "go");
const GO_BINARY_CACHE_DIR = resolve(process.cwd(), ".forge", "test-cache", "go-billing");

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(stripDeterministicHeader(readFileSync(join(root, relative), "utf8"))) as T;
}

function goBinary(): string {
  const candidates = [
    process.env.FORGE_GO,
    "go",
    "C:\\Program Files\\Go\\bin\\go.exe",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const probe = Bun.spawnSync([candidate, "version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (probe.exitCode === 0) {
        return candidate;
      }
    } catch {
      // Try the next well-known install path.
    }
  }
  throw new Error("Go is required for the Go adapter conformance test. Install Go or set FORGE_GO.");
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (!address || typeof address === "string") {
          reject(new Error("failed to allocate port"));
          return;
        }
        resolvePromise(address.port);
      });
    });
    server.on("error", reject);
  });
}

async function removeDirectoryWithRetry(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (!["EACCES", "EBUSY", "EPERM"].includes(code) || attempt === 9) {
        throw error;
      }
      await Bun.sleep(100);
    }
  }
}

function hashGoBillingSources(): string {
  const hash = createHash("sha256");
  function walk(directory: string, label: string): void {
    hash.update(label);
    for (const entry of readdirSync(directory).sort()) {
      const absolute = join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (entry === ".git" || entry === "tmp") {
          continue;
        }
        walk(absolute, `${label}/${entry}`);
        continue;
      }
      if (!entry.endsWith(".go") && entry !== "go.mod" && entry !== "go.sum") {
        continue;
      }
      hash.update(`${label}/${entry}`);
      hash.update(readFileSync(absolute));
    }
  }
  walk(GO_EXAMPLE_DIR, "examples/go-billing");
  walk(GO_ADAPTER_DIR, "adapters/go");
  return hash.digest("hex").slice(0, 16);
}

async function buildGoBillingBinary(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const sourceHash = hashGoBillingSources();
  const directory = join(GO_BINARY_CACHE_DIR, sourceHash);
  mkdirSync(directory, { recursive: true });
  const binaryPath = join(directory, process.platform === "win32" ? "go-billing.exe" : "go-billing");
  if (existsSync(binaryPath)) {
    return {
      path: binaryPath,
      cleanup: async () => {},
    };
  }
  const proc = Bun.spawn([goBinary(), "build", "-o", binaryPath, "."], {
    cwd: GO_EXAMPLE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    await removeDirectoryWithRetry(directory);
    throw new Error(`go build failed: ${stderr || stdout}`);
  }
  if (!existsSync(binaryPath)) {
    await removeDirectoryWithRetry(directory);
    throw new Error(`go build did not create ${binaryPath}`);
  }
  return {
    path: binaryPath,
    cleanup: async () => {},
  };
}

async function runGoBilling(binaryPath: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([binaryPath, ...args], {
    cwd: GO_EXAMPLE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function startGoBilling(binaryPath: string, baseUrl: string, port: number): Promise<{ stop: () => Promise<void> }> {
  const proc = Bun.spawn([
    binaryPath,
    "--addr",
    `127.0.0.1:${port}`,
    "--base-url",
    baseUrl,
  ], {
    cwd: GO_EXAMPLE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`go billing service exited early: ${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return {
          stop: async () => {
            proc.kill();
            await proc.exited.catch(() => undefined);
          },
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(100);
  }

  proc.kill();
  await proc.exited.catch(() => undefined);
  throw new Error(`go billing service did not become healthy: ${lastError}`);
}

describe("Go adapter conformance", () => {
  test("emits a manifest and runs through the Forge external runtime bridge", async () => {
    expect(existsSync(GO_EXAMPLE_DIR)).toBe(true);

    const binary = await buildGoBillingBinary();
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const manifest = await runGoBilling(binary.path, ["--manifest", "--base-url", baseUrl]);
      expect(manifest.exitCode, manifest.stderr).toBe(0);

      const parsedManifest = JSON.parse(manifest.stdout) as {
        language: string;
        framework: string;
        service: { name: string; baseUrl: string };
        entries: Array<{ name: string; kind: string; policy?: string; needsApproval?: boolean; tenantScoped?: boolean }>;
      };
      expect(parsedManifest).toMatchObject({
        language: "go",
        framework: "go/net-http",
        service: { name: "billing", baseUrl },
      });
      expect(parsedManifest.entries.find((entry) => entry.name === "createInvoice")).toMatchObject({
        kind: "command",
        policy: "billing.manage",
        needsApproval: true,
        tenantScoped: true,
      });
      expect(parsedManifest.entries.find((entry) => entry.name === "listInvoices")).toMatchObject({
        kind: "query",
        policy: "billing.manage",
        tenantScoped: true,
      });

      const external = await startGoBilling(binary.path, baseUrl, port);
      try {
        const { root, tenantA } = await scaffoldClientWorkspace("go-adapter-conformance", { generate: false });
        const manifestPath = join(root, "go-billing.manifest.json");
        writeFileSync(manifestPath, manifest.stdout, "utf8");
        try {
          const imported = importExternalManifest(root, manifestPath);
          expect(imported.imported).toBe(true);
          expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);

          const generated = await runGenerateCommand(defaultGenerateOptions(root));
          expect(generated.exitCode).toBe(0);

          const externalServices = readJson<{
            services: Array<{ name: string; language: string; framework?: string; entries: Array<{ name: string; needsApproval?: boolean }> }>;
          }>(root, "src/forge/_generated/externalServices.json");
          expect(externalServices.services[0]).toMatchObject({
            name: "billing",
            language: "go",
            framework: "go/net-http",
          });

          const tools = readJson<{
            autoTools: Array<{ sourceName: string; execution: string; source?: string; needsApproval: boolean }>;
          }>(root, "src/forge/_generated/agentTools.json");
          expect(tools.autoTools.find((tool) => tool.sourceName === "billing.createInvoice")).toMatchObject({
            source: "external",
            execution: "external-runtime-endpoint",
            needsApproval: true,
          });

          const handle = await startClientDevServer(root, { db: "none" });
          try {
            const denied = await fetch(`${handle.url}/external/billing/commands/createInvoice`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-forge-user-id": "u1",
                "x-forge-tenant-id": tenantA,
                "x-forge-role": "member",
              },
              body: JSON.stringify({ args: { title: "Denied" } }),
            });
            expect(denied.status).toBe(403);

            const { createForgeClient, api } = await import(`${root}/src/forge/_generated/client.ts`);
            const client = createForgeClient({
              url: handle.url,
              auth: { userId: "u1", tenantId: tenantA, role: "admin" },
            });

            const created = await client.externalCommand(api.external.commands["billing.createInvoice"], {
              title: "Go invoice",
            }) as { id: string; title: string; tenant: string; authKind: string; userId: string; traceId: string };
            expect(created).toMatchObject({
              id: "inv_go_1",
              title: "Go invoice",
              tenant: tenantA,
              authKind: "user",
              userId: "u1",
            });
            expect(created.traceId.length).toBeGreaterThan(0);

            const listed = await client.externalQuery(api.external.queries["billing.listInvoices"], {}) as Array<{ id: string; title: string; tenant: string }>;
            expect(listed).toEqual([{ id: "inv_go_1", title: "Go adapter invoice", tenant: tenantA }]);

            const failed = await fetch(`${handle.url}/external/billing/commands/createInvoice`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-forge-user-id": "u1",
                "x-forge-tenant-id": tenantA,
                "x-forge-role": "admin",
              },
              body: JSON.stringify({ args: {} }),
            });
            const failedBody = await failed.json() as { ok: boolean; diagnostics: Array<{ code: string; message: string }> };
            expect(failed.status).toBe(400);
            expect(failedBody.ok).toBe(false);
            expect(failedBody.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_GO_HANDLER_FAILED")).toBe(true);
          } finally {
            handle.stop();
          }
        } finally {
          cleanupWorkspace(root);
        }
      } finally {
        await external.stop();
      }
    } finally {
      await binary.cleanup();
    }
  }, 180000);
});
