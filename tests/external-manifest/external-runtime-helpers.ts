import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GENERATED_DIR, GENERATOR_VERSION } from "../../src/forge/compiler/emitter/constants.ts";
import {
  serializeExternalServiceGraphJson,
} from "../../src/forge/compiler/external-manifest/registry.ts";
import type { ForgeExternalServiceGraph } from "../../src/forge/compiler/external-manifest/types.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { tempWorkspace } from "../orchestrator/helpers.ts";
import { nodeForgeSpawnEnv } from "../cli/node-compat-helpers.ts";

export const FORGE_CLI = resolve(process.cwd(), "bin", "forge.mjs");

export function readJson<T>(root: string, relative: string): T {
  return JSON.parse(stripDeterministicHeader(readFileSync(join(root, relative), "utf8"))) as T;
}

export async function runForgeCli(root: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["node", FORGE_CLI, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: nodeForgeSpawnEnv(),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startExternalHttpService(): Promise<{
  url: string;
  stop: () => Promise<void>;
  calls: Array<{ path: string; body: unknown; headers: Record<string, string | string[] | undefined> }>;
}> {
  const calls: Array<{ path: string; body: unknown; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readBody(request);
    const body = bodyText ? JSON.parse(bodyText) : {};
    calls.push({
      path: request.url ?? "",
      body,
      headers: request.headers,
    });

    response.setHeader("content-type", "application/json");
    if (request.url === "/invoices/create") {
      response.end(JSON.stringify({
        ok: true,
        result: {
          created: true,
          title: body.args?.title,
          tenantHeader: request.headers["x-forge-tenant-id"],
          authKind: body.auth?.kind,
        },
      }));
      return;
    }

    if (request.url === "/invoices/list") {
      response.end(JSON.stringify({
        ok: true,
        result: [{ id: "inv_1", tenant: request.headers["x-forge-tenant-id"] }],
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }));
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start external service");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    stop: () => new Promise((resolvePromise, reject) => {
      (server as Server).close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}

export function writeExternalManifest(root: string, baseUrl: string): string {
  const path = join(root, "billing.manifest.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        forgeProtocol: "1.0",
        language: "java",
        framework: "spring-boot",
        service: {
          name: "billing",
          transport: "http",
          baseUrl,
          health: "/health",
        },
        entries: [
          {
            name: "createInvoice",
            kind: "command",
            path: "/invoices/create",
            policy: "billing.manage",
            transaction: "external-managed",
            risk: "write",
            effects: ["invoice.created"],
          },
          {
            name: "listInvoices",
            kind: "query",
            path: "/invoices/list",
            policy: "billing.manage",
            transaction: "read-only",
            risk: "read",
            tenantScoped: true,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

export function writeExternalRuntimeArtifacts(
  root: string,
  graph: ForgeExternalServiceGraph,
): void {
  const generatedDir = join(root, GENERATED_DIR);
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(
    join(generatedDir, "externalServices.json"),
    serializeExternalServiceGraphJson(graph),
    "utf8",
  );
  writeFileSync(
    join(generatedDir, "policyRegistry.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        generatorVersion: GENERATOR_VERSION,
        analyzerVersion: "policy-registry@1.0.0",
        inputHash: graph.inputHash,
        policies: [
          {
            name: "billing.manage",
            kind: "roles",
            roles: ["owner", "admin"],
            file: "src/policies.ts",
            symbolId: "policy:billing.manage",
          },
        ],
        commandAuth: [
          {
            commandName: "billing.createInvoice",
            file: "external:billing",
            symbolId: "external:billing:command:createInvoice",
            auth: { kind: "policy", policy: "billing.manage" },
          },
        ],
        queryAuth: [
          {
            queryName: "billing.listInvoices",
            file: "external:billing",
            symbolId: "external:billing:query:listInvoices",
            auth: { kind: "policy", policy: "billing.manage" },
          },
        ],
        diagnostics: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(generatedDir, "permissionMatrix.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        generatorVersion: GENERATOR_VERSION,
        inputHash: graph.inputHash,
        entries: [{ policy: "billing.manage", roles: ["admin", "owner"] }],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function scaffoldExternalRuntimeWorkspace(prefix: string): { root: string; tenantId: string } {
  const root = tempWorkspace(prefix);
  const tenantId = "11111111-1111-1111-1111-111111111111";
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "forge-external-runtime-test",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  mkdirSync(join(root, "src", "forge"), { recursive: true });
  writeFileSync(join(root, "src", "forge", "schema.ts"), "\n", "utf8");
  writeFileSync(
    join(root, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "billing.manage": canRole("owner", "admin"),
      });
    `,
    "utf8",
  );
  return { root, tenantId };
}
