import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

async function seedBillingTimeline(store: DeltaStore): Promise<void> {
  const actorId = await store.ensureActor("forge", "test");
  const sessionId = await store.createSession({ source: "forge-command", git: { branch: "main", head: "h47" } });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "manifest.imported",
    summary: "import go-billing.manifest.json",
    data: {
      path: "go-billing.manifest.json",
      service: "billing",
      entries: ["billing.createInvoice"],
    },
    artifacts: [{ path: "src/forge/_generated/externalServices.json", generated: true }],
  });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "artifact.generated",
    summary: "generated external runtime artifacts",
    data: { service: "billing", entries: ["billing.createInvoice"] },
    artifacts: [
      { path: "src/forge/_generated/agentContract.json", generated: true },
      { path: "src/forge/_generated/agentTools.json", generated: true },
    ],
  });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "runtime.entry.denied",
    summary: "billing.createInvoice denied",
    data: { entryName: "billing.createInvoice", diagnosticCode: "FORGE_POLICY_DENIED" },
    runtimeCall: {
      entryName: "billing.createInvoice",
      entryKind: "command",
      risk: "write",
      policy: "billing.manage",
      tenantScoped: true,
      result: "denied",
      diagnosticCode: "FORGE_POLICY_DENIED",
      service: "billing",
    },
  });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "file.changed",
    summary: "modified src/policies.ts",
    data: { path: "src/policies.ts", policy: "billing.manage" },
    fileChanges: [{ path: "src/policies.ts", changeType: "modified" }],
  });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "runtime.entry.executed",
    summary: "billing.createInvoice success",
    data: { entryName: "billing.createInvoice" },
    runtimeCall: {
      entryName: "billing.createInvoice",
      entryKind: "command",
      risk: "write",
      policy: "billing.manage",
      tenantScoped: true,
      result: "success",
      service: "billing",
    },
  });
  await store.appendOperation({
    sessionId,
    actorId,
    kind: "proof.run",
    summary: "security prove passed",
    data: { command: "forge security prove", entries: ["billing.createInvoice"] },
    proof: {
      proofKind: "security-prove",
      command: "forge security prove",
      result: "passed",
      assurance: "structural-only",
      artifactPaths: ["src/forge/_generated/agentContract.json"],
    },
  });
}

describe("delta semantic timeline", () => {
  test("projects runtime entry history with entities and causal edges", async () => {
    const root = tempWorkspace("semantic-runtime");
    try {
      const store = await DeltaStore.open(root);
      await seedBillingTimeline(store);

      const timeline = await store.semanticTimeline({ target: "billing.createInvoice" });
      await store.close();

      expect(timeline.entity).toEqual({ kind: "runtime-entry", name: "billing.createInvoice" });
      expect(timeline.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
        "imported",
        "generated",
        "denied",
        "policy.changed",
        "executed",
        "proof.passed",
      ]));
      expect(timeline.currentState.policy).toBe("billing.manage");
      expect(timeline.currentState.proofStatus).toBe("fresh");
      expect(timeline.causalEdges.some((edge) => edge.kind === "fixed")).toBe(true);
      expect(timeline.causalEdges.some((edge) => edge.kind === "validated")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("queries policy and diagnostic timelines through causal neighbors", async () => {
    const root = tempWorkspace("semantic-diagnostic");
    try {
      const store = await DeltaStore.open(root);
      await seedBillingTimeline(store);

      const policy = await store.semanticTimeline({ target: "policy:billing.manage" });
      const diagnostic = await store.semanticTimeline({ target: "diagnostic:FORGE_POLICY_DENIED" });
      await store.close();

      expect(policy.events.some((event) => event.kind === "policy.changed")).toBe(true);
      expect(policy.events.some((event) => event.kind === "denied")).toBe(true);
      expect(diagnostic.events.some((event) => event.kind === "policy.changed")).toBe(true);
      expect(diagnostic.events.some((event) => event.kind === "executed")).toBe(true);
      expect(diagnostic.currentState.resolved).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("marks proof timeline stale after a later policy change", async () => {
    const root = tempWorkspace("semantic-proof-stale");
    try {
      const store = await DeltaStore.open(root);
      await seedBillingTimeline(store);
      const sessionId = await store.createSession({ source: "forge-command" });
      await store.appendOperation({
        sessionId,
        kind: "file.changed",
        summary: "changed policy after proof",
        data: { path: "src/policies.ts", policy: "billing.manage" },
        fileChanges: [{ path: "src/policies.ts", changeType: "modified" }],
      });

      const proof = await store.semanticTimeline({ target: "proof:security-prove" });
      await store.close();

      expect(proof.currentState.proofStatus).toBe("stale");
      expect(proof.openQuestions).toContain("Proof is stale after the latest relevant change");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rebuilds deterministic semantic projection content", async () => {
    const root = tempWorkspace("semantic-rebuild");
    try {
      const store = await DeltaStore.open(root);
      await seedBillingTimeline(store);
      const before = await store.semanticTimeline({ target: "service:billing" });
      await store.rebuildSemanticTimeline();
      const after = await store.semanticTimeline({ target: "service:billing" });
      await store.close();

      expect(after.events.map((event) => [event.id, event.kind, event.title])).toEqual(
        before.events.map((event) => [event.id, event.kind, event.title]),
      );
      expect(after.causalEdges.map((edge) => [edge.id, edge.kind])).toEqual(
        before.causalEdges.map((edge) => [edge.id, edge.kind]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses semantic timeline commands", () => {
    const policy = parseCli(["timeline", "policy:billing.manage", "--json", "--for-agent"]).command;
    expect(policy?.kind).toBe("timeline");
    if (policy?.kind === "timeline") {
      expect(policy.target).toBe("policy:billing.manage");
      expect(policy.forAgent).toBe(true);
    }

    const rebuild = parseCli(["timeline", "rebuild"]).command;
    expect(rebuild?.kind).toBe("timeline");
    if (rebuild?.kind === "timeline") {
      expect(rebuild.rebuild).toBe(true);
      expect(rebuild.target).toBeUndefined();
    }
  });
});
