import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { resolveAuditWaiver, isExpired } = await import(pathToFileURL(resolve("scripts/dependency-audit-policy.mjs")).href);
const waivers = JSON.parse(readFileSync("security/dependency-audit-waivers.json", "utf8")).waivers;
const target = "template:nuxt-web-web";
const bracesAdvisory = { url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", severity: "high" };
const forgeAdvisory = { url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv", severity: "high" };
const fixture = () => ({
  braces: { severity: "high", via: [bracesAdvisory] },
  "node-forge": { severity: "high", via: [forgeAdvisory] },
  micromatch: { severity: "high", via: ["braces"] },
  listhen: { severity: "high", via: ["node-forge"] },
  nuxt: { severity: "high", via: ["micromatch", "listhen"] },
});
const approved = (name: string, graph: Record<string, unknown> = fixture(), date = "2026-10-05", scope = target) => resolveAuditWaiver(scope, name, graph, waivers, date);

test("owner exception selects exactly the two Nuxt advisories and attributes propagated findings", () => {
  expect(waivers).toHaveLength(2);
  const approval = approved("nuxt");
  expect(approval.advisories).toEqual([forgeAdvisory.url, bracesAdvisory.url].sort());
  expect(approval.expires).toBe("2026-10-18");
  expect(approved("braces", fixture(), "2026-10-05", "framework")).toBeNull();
});
test("approval expires automatically after fourteen inclusive UTC dates", () => {
  expect(approved("nuxt", fixture(), "2026-10-18")).not.toBeNull();
  expect(approved("nuxt", fixture(), "2026-10-19")).toBeNull();
  expect(isExpired({ expires: "2026-02-30" }, "2026-01-01")).toBe(true);
});
test("a second advisory on the approved package still blocks it and every parent", () => {
  const graph = fixture(); graph.braces.via.push({ url: "https://github.com/advisories/NEW-UNAPPROVED", severity: "high" });
  expect(approved("braces", graph)).toBeNull(); expect(approved("nuxt", graph)).toBeNull();
});
test("an additional vulnerable dependency blocks the propagated parent", () => {
  const graph: Record<string, any> = fixture();
  graph.unrelated = { severity: "high", via: [{ url: "unapproved", severity: "high" }] };
  graph.nuxt.via.push("unrelated"); expect(approved("nuxt", graph)).toBeNull();
});
test("critical metadata and critical direct advisories remain blocking", () => {
  const graph = fixture(); graph.nuxt.severity = "critical";
  expect(approved("nuxt", graph)).toBeNull();
  graph.braces.severity = "critical";
  expect(approved("braces", graph)).toBeNull();
  graph.braces.severity = "high";
  graph.braces.via = [{ ...bracesAdvisory, severity: "critical" }];
  expect(approved("braces", graph)).toBeNull();
});
test("missing edges, empty reports and cycles cannot manufacture inherited approval", () => {
  const graph: Record<string, any> = fixture(); graph.nuxt.via.push("absent");
  expect(approved("nuxt", graph)).toBeNull();
  graph.nuxt.via = ["nuxt"]; expect(approved("nuxt", graph)).toBeNull();
  graph.nuxt.via = []; expect(approved("nuxt", graph)).toBeNull();
});
