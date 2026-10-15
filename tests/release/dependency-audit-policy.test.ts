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

const cyclicFixture = () => ({
  "node-forge": { severity: "high", via: [forgeAdvisory] },
  listhen: { severity: "high", via: ["node-forge"] },
  nitropack: { severity: "high", via: ["listhen"] },
  "@nuxt/devtools": { severity: "high", via: ["nitropack"] },
  "@nuxt/nitro-server": { severity: "high", via: ["nitropack", "nuxt"] },
  "@nuxt/vite-builder": { severity: "high", via: ["nuxt"] },
  "@nuxt/vite-server": { severity: "high", via: ["nuxt"] },
  nuxt: { severity: "high", via: ["@nuxt/devtools", "@nuxt/nitro-server", "@nuxt/vite-builder", "@nuxt/vite-server"] },
});

test("npm dependency cycles anchored only in an approved advisory inherit its existing scope", () => {
  for (const name of Object.keys(cyclicFixture())) {
    const approval = approved(name, cyclicFixture());
    expect(approval?.advisories).toEqual([forgeAdvisory.url]);
    expect(approval?.expires).toBe("2026-10-18");
  }
});

test("an approved branch cannot legitimize a separate advisory-free cycle", () => {
  const graph: Record<string, any> = cyclicFixture();
  graph.orphan = { severity: "high", via: ["orphan"] };
  graph.nuxt.via.push("orphan");
  expect(approved("nuxt", graph)).toBeNull();
  graph.orphan.via = ["orphan-peer"];
  graph["orphan-peer"] = { severity: "high", via: ["orphan"] };
  expect(approved("nuxt", graph)).toBeNull();
});

test("every advisory reachable through a dependency cycle still requires approval", () => {
  const graph: Record<string, any> = cyclicFixture();
  graph["@nuxt/vite-server"].via.push({ url: "https://github.com/advisories/NEW-UNAPPROVED", severity: "high" });
  for (const name of ["nuxt", "@nuxt/nitro-server", "@nuxt/vite-builder", "@nuxt/vite-server"]) {
    expect(approved(name, graph)).toBeNull();
  }
});

test("missing edges, higher severity, expiry and target scope still block anchored cycles", () => {
  const graph: Record<string, any> = cyclicFixture();
  graph["@nuxt/vite-server"].via.push("absent");
  expect(approved("nuxt", graph)).toBeNull();
  graph["@nuxt/vite-server"].via.pop();
  graph["@nuxt/vite-server"].severity = "critical";
  expect(approved("nuxt", graph)).toBeNull();
  graph["@nuxt/vite-server"].severity = "high";
  expect(approved("nuxt", graph, "2026-10-19")).toBeNull();
  expect(approved("nuxt", graph, "2026-10-05", "framework")).toBeNull();
});

test("cyclic propagation does not suppress a new advisory on an approved leaf", () => {
  const graph: Record<string, any> = cyclicFixture();
  graph["node-forge"].via.push({ url: "https://github.com/advisories/NEW-UNAPPROVED", severity: "high" });
  expect(approved("nuxt", graph)).toBeNull();
});
