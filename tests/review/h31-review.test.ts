import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  renderSarif,
  runReviewCommand,
} from "../../src/forge/review/index.ts";
import type { ReviewCommandOptions } from "../../src/forge/review/types.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h31-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  spawnSync("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function stage(root: string, ...files: string[]): void {
  spawnSync("git", ["add", ...files], { cwd: root, windowsHide: true });
}

function writeGenerated(root: string): void {
  write(root, "src/forge/_generated/appGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    symbols: [],
    edges: [],
    moduleGraph: { nodes: [] },
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/dataGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    tables: [{ id: "tickets", name: "tickets", symbolId: "tickets", exportName: "tickets", file: "src/forge/schema.ts", fields: [{ name: "tenantId", type: "text" }] }],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/packageGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    packages: [{ name: "stripe", version: "18.0.0" }],
  }));
  write(root, "src/forge/_generated/runtimeGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    entries: [],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/queryRegistry.json", JSON.stringify({ queries: [], diagnostics: [] }));
  write(root, "src/forge/_generated/liveQueryRegistry.json", JSON.stringify({ liveQueries: [], diagnostics: [] }));
  write(root, "src/forge/_generated/policyRegistry.json", JSON.stringify({
    policies: [{ name: "tickets.read", roles: ["admin"] }],
    commandAuth: [],
    queryAuth: [],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/actionSubscriptions.json", JSON.stringify({
    subscriptions: [],
    byEvent: {},
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/workflowRegistry.json", JSON.stringify({ workflows: [], diagnostics: [] }));
  write(root, "src/forge/_generated/workflowSubscriptions.json", JSON.stringify({
    subscriptions: [],
    byEvent: {},
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/testGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    tests: [],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/agentContract.json", JSON.stringify({ schemaVersion: "0.1.0" }));
}

function options(root: string, overrides: Partial<ReviewCommandOptions> = {}): ReviewCommandOptions {
  return {
    subcommand: "run",
    workspaceRoot: root,
    json: true,
    md: false,
    sarif: false,
    write: false,
    changed: false,
    staged: true,
    mode: "standard",
    include: [],
    exclude: [],
    ...overrides,
  };
}

describe("H31 structured Forge review", () => {
  test("command with forbidden import creates blocking runtime finding", () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/commands/createCheckout.ts", `
      import Stripe from "stripe";
      export async function createCheckout(ctx) { return new Stripe("x"); }
    `);
    stage(root, "src/commands/createCheckout.ts");

    const result = runReviewCommand(options(root, { failOn: "blocking" }));

    expect(result.exitCode).toBe(1);
    expect(result.report?.findings.map((finding) => finding.code)).toContain("runtime-command-forbidden-import");
    expect(result.report?.risk.blockers).toContain("runtime-command-forbidden-import");
  });

  test("data, policy, secret, package, workflow, liveQuery, frontend, deploy, and agent findings are deterministic", () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/schema.ts", `export const tickets = table({ tenantId: text(), title: text({ required: true }) });`);
    write(root, "src/policies.ts", `export const policies = { "tickets.read": { roles: ["owner", "admin", "member"] } };`);
    write(root, "src/actions/sendInvoice.ts", `export async function sendInvoice() { return process.env.STRIPE_SECRET_KEY; }`);
    write(root, "package.json", JSON.stringify({ dependencies: { stripe: "19.0.0" } }));
    write(root, "src/commands/createTicket.ts", `export async function createTicket(ctx) { ctx.emit("ticket.created", {}); }`);
    write(root, "src/queries/liveTickets.ts", `export async function liveTickets(ctx) { return ctx.db.raw("select * from tickets"); }`);
    write(root, "web/components/TicketList.tsx", `import { api } from "../../src/forge/_generated/serverApi"; export function TicketList() { fetch("/runtime/tickets"); return null; }`);
    write(root, "deploy/docker-compose.yml", `environment:\n  ALLOW_DEV_AUTH: "true"\n`);
    write(root, "AGENTS.md", `custom`);
    stage(root, "src/forge/schema.ts", "src/policies.ts", "src/actions/sendInvoice.ts", "package.json", "src/commands/createTicket.ts", "src/queries/liveTickets.ts", "web/components/TicketList.tsx", "deploy/docker-compose.yml", "AGENTS.md");

    const first = runReviewCommand(options(root));
    const second = runReviewCommand(options(root));
    const codes = first.report?.findings.map((finding) => finding.code) ?? [];

    expect(codes).toContain("data-tenant-index-missing");
    expect(codes).toContain("policy-widened");
    expect(codes).toContain("secret-env-example-missing");
    expect(codes).toContain("package-change-without-plan");
    expect(codes).toContain("event-no-subscriber");
    expect(codes).toContain("livequery-invalidation-test-missing");
    expect(codes).toContain("frontend-server-import");
    expect(codes).toContain("deploy-dev-auth");
    expect(codes).toContain("agent-contract-stale");
    expect(first.report?.risk.score).toBe(second.report?.risk.score);
    expect(first.report?.id).toBe(second.report?.id);
  });

  test("write creates markdown, checklist, and SARIF outputs", () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/commands/createCheckout.ts", `import Stripe from "stripe"; export async function createCheckout() { return Stripe; }`);
    stage(root, "src/commands/createCheckout.ts");

    const result = runReviewCommand(options(root, { write: true, sarif: true }));
    const written = result.writeResult;

    expect(written).toBeDefined();
    expect(written!.files).toContain(`${written!.dir}/review.md`);
    expect(written!.files).toContain(`${written!.dir}/human-checklist.md`);
    expect(written!.files).toContain(`${written!.dir}/review.sarif`);
    expect(existsSync(join(root, written!.dir, "review.json"))).toBe(true);
    const sarif = JSON.parse(readFileSync(join(root, written!.dir, "review.sarif"), "utf8"));
    expect(sarif.version).toBe("2.1.0");
  });

  test("parser supports review commands and rule explanations", () => {
    const parsed = parseCli(["review", "--base", "main", "--write", "--sarif", "--fail-on", "blocking"]);
    expect(parsed.command).toMatchObject({
      kind: "review",
      options: { subcommand: "run", base: "main", write: true, sarif: true, failOn: "blocking" },
    });
    const writeParsed = parseCli(["review", "write", "--changed"]);
    expect(writeParsed.command).toMatchObject({
      kind: "review",
      options: { subcommand: "run", changed: true, write: true },
    });

    const explain = runReviewCommand(options(workspace(), {
      subcommand: "explain",
      ruleId: "runtime-command-forbidden-import",
    }));
    expect(explain.explanation).toContain("Rule: runtime-command-forbidden-import");
  });

  test("SARIF output maps findings to rules", () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "web/components/Admin.tsx", `import { db } from "../../src/forge/_generated/db"; export function Admin() { return null; }`);
    stage(root, "web/components/Admin.tsx");

    const result = runReviewCommand(options(root));
    const sarif = JSON.parse(renderSarif(result.report!));

    expect(sarif.runs[0].results[0].ruleId).toBe("frontend-server-import");
  });
});
