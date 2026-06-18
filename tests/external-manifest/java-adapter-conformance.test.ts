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

const JAVA_ADAPTER_DIR = resolve(process.cwd(), "adapters", "java");
const JAVA_SPRING_STARTER_DIR = resolve(process.cwd(), "adapters", "java-spring-boot-starter");
const JAVA_EXAMPLE_DIR = resolve(process.cwd(), "examples", "java-billing");
const JAVA_BUILD_CACHE_DIR = resolve(process.cwd(), ".forge", "test-cache", "java-billing");
const MAVEN_LOCAL_REPO = resolve(process.cwd(), ".forge", "test-cache", "java-m2");

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(stripDeterministicHeader(readFileSync(join(root, relative), "utf8"))) as T;
}

function commandExists(command: string, args: string[]): boolean {
  try {
    const probe = Bun.spawnSync(wrapWindowsCommand([command, ...args]), {
      stdout: "pipe",
      stderr: "pipe",
    });
    return probe.exitCode === 0;
  } catch {
    return false;
  }
}

function findJavaBinary(): string | undefined {
  const candidates = [
    process.env.FORGE_JAVA,
    "java",
    "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot\\bin\\java.exe",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (commandExists(candidate, ["-version"])) {
      return candidate;
    }
  }
  return undefined;
}

function javaBinary(): string {
  const binary = findJavaBinary();
  if (binary) {
    return binary;
  }
  throw new Error("Java 17 is required for the Java adapter conformance test. Install Java or set FORGE_JAVA.");
}

function findMavenBinary(): string | undefined {
  const localMaven = resolve(process.cwd(), ".forge", "local", "tools", "apache-maven-3.9.16", "bin", process.platform === "win32" ? "mvn.cmd" : "mvn");
  const candidates = [
    process.env.FORGE_MAVEN,
    "mvn",
    localMaven,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (commandExists(candidate, ["-version"])) {
      return candidate;
    }
  }
  return undefined;
}

function mavenBinary(): string {
  const binary = findMavenBinary();
  if (binary) {
    return binary;
  }
  throw new Error("Maven is required for the Java adapter conformance test. Install Maven or set FORGE_MAVEN.");
}

function javaToolchainSkipReason(): string | undefined {
  if (!findJavaBinary()) {
    return "Java 17 is missing; set FORGE_JAVA to run the conformance test";
  }
  if (!findMavenBinary()) {
    return "Maven is missing; set FORGE_MAVEN to run the conformance test";
  }
  return undefined;
}

function wrapWindowsCommand(command: string[]): string[] {
  const executable = command[0]!;
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) {
    return command;
  }
  return [process.env.ComSpec ?? "cmd.exe", "/d", "/c", ...command];
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

function hashJavaSources(): string {
  const hash = createHash("sha256");
  function walk(directory: string, label: string): void {
    hash.update(label);
    for (const entry of readdirSync(directory).sort()) {
      const absolute = join(directory, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (entry === "target") {
          continue;
        }
        walk(absolute, `${label}/${entry}`);
        continue;
      }
      if (!entry.endsWith(".java") && entry !== "pom.xml") {
        continue;
      }
      hash.update(`${label}/${entry}`);
      hash.update(readFileSync(absolute));
    }
  }
  walk(JAVA_ADAPTER_DIR, "adapters/java");
  walk(JAVA_SPRING_STARTER_DIR, "adapters/java-spring-boot-starter");
  walk(JAVA_EXAMPLE_DIR, "examples/java-billing");
  return hash.digest("hex").slice(0, 16);
}

async function runMaven(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const mvn = mavenBinary();
  const proc = Bun.spawn(wrapWindowsCommand([
    mvn,
    "-Dmaven.repo.local=" + MAVEN_LOCAL_REPO,
    "-DskipTests",
    ...args,
  ]), {
    cwd,
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

async function buildJavaBillingJar(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const sourceHash = hashJavaSources();
  const directory = join(JAVA_BUILD_CACHE_DIR, sourceHash);
  const jarPath = join(JAVA_EXAMPLE_DIR, "target", "java-billing-0.1.0-alpha.11-all.jar");
  const marker = join(directory, "built");
  mkdirSync(directory, { recursive: true });
  mkdirSync(MAVEN_LOCAL_REPO, { recursive: true });

  if (existsSync(marker) && existsSync(jarPath)) {
    return { path: jarPath, cleanup: async () => {} };
  }

  const adapter = await runMaven(JAVA_ADAPTER_DIR, ["install"]);
  expect(adapter.exitCode, adapter.stderr || adapter.stdout).toBe(0);

  const starter = await runMaven(JAVA_SPRING_STARTER_DIR, ["install"]);
  expect(starter.exitCode, starter.stderr || starter.stdout).toBe(0);

  const example = await runMaven(JAVA_EXAMPLE_DIR, ["package"]);
  if (example.exitCode !== 0) {
    await removeDirectoryWithRetry(directory);
    throw new Error(`java billing build failed: ${example.stderr || example.stdout}`);
  }
  if (!existsSync(jarPath)) {
    await removeDirectoryWithRetry(directory);
    throw new Error(`java billing build did not create ${jarPath}`);
  }
  writeFileSync(marker, "ok\n", "utf8");
  return { path: jarPath, cleanup: async () => {} };
}

async function runJavaBilling(jarPath: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(wrapWindowsCommand([javaBinary(), "-jar", jarPath, ...args]), {
    cwd: JAVA_EXAMPLE_DIR,
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

async function startJavaBilling(jarPath: string, baseUrl: string, port: number): Promise<{ stop: () => Promise<void> }> {
  const proc = Bun.spawn(wrapWindowsCommand([
    javaBinary(),
    "-jar",
    jarPath,
    "--addr",
    `127.0.0.1:${port}`,
    "--base-url",
    baseUrl,
  ]), {
    cwd: JAVA_EXAMPLE_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  let lastError = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (proc.exitCode !== null) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`java billing service exited early: ${stderr}`);
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
  throw new Error(`java billing service did not become healthy: ${lastError}`);
}

const javaSkipReason = javaToolchainSkipReason();

describe.skipIf(Boolean(javaSkipReason))(`Java adapter conformance${javaSkipReason ? ` (${javaSkipReason})` : ""}`, () => {
  test("emits a manifest and runs through the Forge external runtime bridge", async () => {
    expect(existsSync(JAVA_ADAPTER_DIR)).toBe(true);
    expect(existsSync(JAVA_EXAMPLE_DIR)).toBe(true);

    const jar = await buildJavaBillingJar();
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      const manifest = await runJavaBilling(jar.path, ["--manifest", "--base-url", baseUrl]);
      expect(manifest.exitCode, manifest.stderr).toBe(0);

      const parsedManifest = JSON.parse(manifest.stdout) as {
        language: string;
        framework: string;
        service: { name: string; baseUrl: string };
        entries: Array<{ name: string; kind: string; policy?: string; needsApproval?: boolean; tenantScoped?: boolean }>;
      };
      expect(parsedManifest).toMatchObject({
        language: "java",
        framework: "java/jdk-http",
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

      const external = await startJavaBilling(jar.path, baseUrl, port);
      try {
        const { root, tenantA } = await scaffoldClientWorkspace("java-adapter-conformance", { generate: false });
        const manifestPath = join(root, "java-billing.manifest.json");
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
            language: "java",
            framework: "java/jdk-http",
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
              title: "Java invoice",
            }) as { id: string; title: string; tenant: string; authKind: string; userId: string; traceId: string };
            expect(created).toMatchObject({
              id: "inv_java_1",
              title: "Java invoice",
              tenant: tenantA,
              authKind: "user",
              userId: "u1",
            });
            expect(created.traceId.length).toBeGreaterThan(0);

            const listed = await client.externalQuery(api.external.queries["billing.listInvoices"], {}) as Array<{ id: string; title: string; tenant: string }>;
            expect(listed).toEqual([{ id: "inv_java_1", title: "Java adapter invoice", tenant: tenantA }]);

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
            expect(failedBody.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_JAVA_HANDLER_FAILED")).toBe(true);
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
      await jar.cleanup();
    }
  }, 240000);
});
