import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  BROWNFIELD_IMPORT_ARTIFACTS,
  inspectBrownfieldImport,
  runBrownfieldImportCommand,
} from "../../src/forge/brownfield-import/index.ts";
import type { ImportedCandidateEntry, ImportedFrontendCall, ImportedRoute } from "../../src/forge/brownfield-import/types.ts";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-h49-import-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "brownfield-app",
      dependencies: {
        next: "^15.0.0",
        express: "^5.0.0",
        stripe: "^18.0.0",
        "@prisma/client": "^6.0.0",
      },
      devDependencies: {
        typescript: "^5.0.0",
      },
      scripts: {
        dev: "next dev",
      },
    }, null, 2),
    "utf8",
  );
  mkdirSync(join(root, "src", "app", "api", "users", "[id]"), { recursive: true });
  writeFileSync(
    join(root, "src", "app", "api", "users", "[id]", "route.ts"),
    `
      export async function GET(req: Request) {
        const tenantId = process.env.TENANT_ID;
        return Response.json({ tenantId });
      }

      export async function DELETE(req: Request) {
        await prisma.user.delete({ where: { id: "u1" } });
        return Response.json({ ok: true });
      }
    `,
    "utf8",
  );
  mkdirSync(join(root, "app", "api", "tickets", "[id]"), { recursive: true });
  writeFileSync(
    join(root, "app", "api", "tickets", "[id]", "route.ts"),
    `
      export async function GET() {
        return Response.json({ ok: true });
      }

      export async function POST() {
        return Response.json({ ok: true });
      }
    `,
    "utf8",
  );
  mkdirSync(join(root, "pages", "api", "billing"), { recursive: true });
  writeFileSync(
    join(root, "pages", "api", "billing", "refund.ts"),
    `
      export default async function handler(req, res) {
        res.json({ ok: true });
      }
    `,
    "utf8",
  );
  mkdirSync(join(root, "server"), { recursive: true });
  writeFileSync(
    join(root, "server", "routes.ts"),
    `
      import express from "express";
      const router = express.Router();
      router.get("/api/tickets", async (req, res) => {
        res.json([{ title: "read only" }]);
      });
      router.post("/api/tickets", async (req, res) => {
        await prisma.ticket.create({ data: req.body });
        res.json({ ok: true });
      });
      router.post("/api/search", async (req, res) => {
        res.json({ results: [] });
      });
      router.post("/api/checkout", async (req, res) => {
        const tenantId = req.body.tenantId;
        await stripe.checkout.sessions.create({});
        res.json({ ok: true, tenantId });
      });
    `,
    "utf8",
  );
  mkdirSync(join(root, "src", "components"), { recursive: true });
  writeFileSync(
    join(root, "src", "components", "Users.tsx"),
    `
      export function Users() {
        fetch("/api/users/123");
        axios.post("/api/checkout", {});
        return null;
      }
    `,
    "utf8",
  );
  return root;
}

function makeSpringWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-h49-spring-import-"));
  writeFileSync(
    join(root, "pom.xml"),
    `
      <project>
        <groupId>com.example</groupId>
        <artifactId>spring-brownfield</artifactId>
        <dependencies>
          <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
          </dependency>
          <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
          </dependency>
        </dependencies>
      </project>
    `,
    "utf8",
  );
  const controllerDir = join(root, "src", "main", "java", "com", "example", "orders");
  mkdirSync(controllerDir, { recursive: true });
  writeFileSync(
    join(controllerDir, "OrderController.java"),
    `
      package com.example.orders;

      @RestController
      @RequestMapping("/api/orders")
      public class OrderController {
        @GetMapping("/{id}")
        public Order findById(@PathVariable String id) {
          String region = System.getenv("AWS_REGION");
          return service.findById(id, region);
        }

        @PostMapping
        public Order create(@RequestBody CreateOrder input) {
          return repository.save(input.toOrder());
        }

        @RequestMapping(path = "/{id}", method = RequestMethod.DELETE)
        public void remove(@PathVariable String id) {
          repository.deleteById(id);
        }
      }
    `,
    "utf8",
  );
  return root;
}

describe("H49 brownfield import analyze", () => {
  test("writes import artifacts and keeps imported entries hidden from agents", () => {
    const root = makeWorkspace();
    try {
      const result = runBrownfieldImportCommand({
        subcommand: "analyze",
        json: true,
        dryRun: false,
        workspaceRoot: root,
      });
      expect(result.exitCode).toBe(0);
      expect(result.inventory?.dependencies.frameworks).toContain("next");
      expect(result.inventory?.dependencies.externalPackages).toContain("stripe");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("GET /api/users/:id");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("DELETE /api/users/:id");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("GET /api/tickets/:id");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("POST /api/tickets/:id");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("ANY /api/billing/refund");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("GET /api/tickets");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("POST /api/tickets");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("POST /api/search");
      expect(result.routes.map((route) => `${route.method} ${route.path}`)).toContain("POST /api/checkout");
      expect(result.frontendCalls.some((call) => call.url === "/api/checkout" && call.client === "axios")).toBe(true);
      expect(result.candidateEntries.length).toBeGreaterThanOrEqual(3);
      expect(result.candidateEntries.every((entry) => entry.origin === "imported")).toBe(true);
      expect(result.candidateEntries.every((entry) => entry.assurance === "static-scan")).toBe(true);
      expect(result.candidateEntries.every((entry) => entry.reviewStatus === "needs-review")).toBe(true);
      expect(result.candidateEntries.every((entry) => entry.visibleToAgent === false)).toBe(true);

      const destructive = result.candidateEntries.find((entry) => entry.method === "DELETE");
      expect(destructive?.needsApproval).toBe(true);
      expect(destructive?.risks).toContain("destructive");
      const expressRead = result.candidateEntries.find((entry) => entry.method === "GET" && entry.path === "/api/tickets");
      expect(expressRead?.kind).toBe("query");
      expect(expressRead?.risks).not.toContain("writes-state");
      const search = result.candidateEntries.find((entry) => entry.method === "POST" && entry.path === "/api/search");
      expect(search?.kind).toBe("command-candidate");
      expect(search?.confidence).toBeLessThan(0.7);
      expect(search?.risks).toContain("ambiguous-post-query");
      expect(search?.risks).not.toContain("writes-state");
      expect(result.riskReport?.findings.some((finding) => finding.code === "FORGE_IMPORT_TENANT_SPOOFABLE")).toBe(true);

      for (const relativePath of Object.values(BROWNFIELD_IMPORT_ARTIFACTS)) {
        expect(existsSync(join(root, relativePath))).toBe(true);
      }

      const routes = JSON.parse(readFileSync(join(root, BROWNFIELD_IMPORT_ARTIFACTS.routes), "utf8")) as ImportedRoute[];
      const calls = JSON.parse(readFileSync(join(root, BROWNFIELD_IMPORT_ARTIFACTS.frontendCalls), "utf8")) as ImportedFrontendCall[];
      const candidates = JSON.parse(readFileSync(join(root, BROWNFIELD_IMPORT_ARTIFACTS.candidateEntries), "utf8")) as ImportedCandidateEntry[];
      expect(routes.length).toBe(result.routes.length);
      expect(calls.length).toBe(result.frontendCalls.length);
      expect(candidates.every((candidate) => candidate.visibleToAgent === false)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("inspect reads existing artifacts without re-scanning", () => {
    const root = makeWorkspace();
    try {
      runBrownfieldImportCommand({
        subcommand: "analyze",
        json: true,
        dryRun: false,
        workspaceRoot: root,
      });
      const inspected = inspectBrownfieldImport(root);
      expect(inspected.exitCode).toBe(0);
      expect(inspected.riskReport?.summary.hiddenFromAgents).toBe(inspected.candidateEntries.length);
      expect(inspected.migrationPlan).toContain("Brownfield Import Migration Plan");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dry-run analyzes without writing artifacts", () => {
    const root = makeWorkspace();
    try {
      const result = runBrownfieldImportCommand({
        subcommand: "analyze",
        json: true,
        dryRun: true,
        workspaceRoot: root,
      });
      expect(result.exitCode).toBe(0);
      expect(result.wroteArtifacts).toBe(false);
      expect(existsSync(join(root, BROWNFIELD_IMPORT_ARTIFACTS.inventory))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("discovers Java Spring Boot controllers, methods, dependencies, and environment usage", () => {
    const root = makeSpringWorkspace();
    try {
      const result = runBrownfieldImportCommand({
        subcommand: "analyze",
        json: true,
        dryRun: true,
        workspaceRoot: root,
      });

      expect(result.exitCode).toBe(0);
      expect(result.inventory?.packageName).toBe("spring-brownfield");
      expect(result.inventory?.dependencies.frameworks).toContain("spring-boot");
      expect(result.inventory?.dependencies.dataPackages).toContain("org.springframework.boot:spring-boot-starter-data-jpa");
      expect(result.inventory?.sourceFiles).toContain("src/main/java/com/example/orders/OrderController.java");
      expect(result.inventory?.env.processEnv).toContain("AWS_REGION");
      expect(result.routes).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/api/orders/:id", source: "spring", handler: "findById" }),
        expect.objectContaining({ method: "POST", path: "/api/orders", source: "spring", handler: "create" }),
        expect.objectContaining({ method: "DELETE", path: "/api/orders/:id", source: "spring", handler: "remove" }),
      ]));
      expect(result.candidateEntries.find((entry) => entry.method === "GET")?.kind).toBe("query");
      expect(result.candidateEntries.find((entry) => entry.method === "POST")?.risks).toContain("writes-state");
      expect(result.candidateEntries.find((entry) => entry.method === "DELETE")?.risks).toContain("destructive");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
