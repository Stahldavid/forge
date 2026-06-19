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
});
