import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { readRepositoryManifest, resolveRepositoryRoot, validateRepositoryManifest } from "../../src/forge/repository-manifest/index.ts";
import { loadExternalManifestRegistry } from "../../src/forge/compiler/external-manifest/registry.ts";
import { validateExternalManifest } from "../../src/forge/compiler/external-manifest/validate.ts";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { runRepositoryCommand } from "../../src/forge/cli/repository.ts";

const manifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["java"] }] };
test("manifest schema accepts both protocols including structured stdio argv", () => {
  const validate = new Ajv({ strict: false }).compile(JSON.parse(readFileSync("schemas/forge-manifest.schema.json", "utf8")));
  const service = { forgeProtocol: "1.0", language: "java", service: { name: "java", transport: "stdio", commandArgs: ["java", "Main"] }, entries: [] };
  expect(validate(manifest)).toBe(true);
  expect(validateRepositoryManifest(manifest).manifest).not.toBeNull();
  expect(validate(service)).toBe(true);
  expect(validateExternalManifest(service).manifest).not.toBeNull();
  expect(validate({ ...manifest, surprise: true })).toBe(false);
  expect(validateRepositoryManifest({ ...manifest, components: [manifest.components[0], manifest.components[0]] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, components: [{ id: "bad", root: "../escape", adapters: ["java"] }] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, components: [{ id: "a", root: "frontend", adapters: ["vue"] }, { id: "b", root: "./frontend/.", adapters: ["vue"] }] }).manifest).toBeNull();
});

test("root repository manifest is not mistaken for executable service; explicit references retain service contract", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-manifest-"));
  try {
    writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    expect(loadExternalManifestRegistry(root).registry.manifests).toEqual([]);
    expect(loadExternalManifestRegistry(root).diagnostics).toEqual([]);
    const service = { forgeProtocol: "1.0", language: "java", service: { name: "billing", transport: "http", baseUrl: "http://localhost:9999" }, entries: [] };
    writeFileSync(join(root, "service.json"), JSON.stringify(service));
    writeFileSync(join(root, "forge.manifest.json"), JSON.stringify({ ...manifest, services: ["service.json"] }));
    expect(loadExternalManifestRegistry(root).registry.manifests[0]?.service.name).toBe("billing");
    writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(service));
    expect(readRepositoryManifest(root)).toEqual({ manifest: null, diagnostics: [] });
    expect(loadExternalManifestRegistry(root).registry.manifests[0]?.service.name).toBe("billing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("nested Java directory resolves manifesto without package.json or Git; external manifests require explicit root", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-root-"));
  try {
    mkdirSync(join(root, "backend", "src"), { recursive: true });
    writeFileSync(join(root, "pom.xml"), "<project/>");
    expect(await resolveRepositoryRoot({ cwd: join(root, "backend", "src") })).toBe(root);
    writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    expect(await resolveRepositoryRoot({ cwd: join(root, "backend", "src") })).toBe(root);
    await expect(resolveRepositoryRoot({ cwd: root, manifestPath: join(root, "forge.manifest.json") })).rejects.toThrow("explicit");
    expect(await resolveRepositoryRoot({ root, manifestPath: join(root, "forge.manifest.json") })).toBe(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("manifest validation refuses sensitive files without echoing their contents", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-sensitive-"));
  try {
    for (const filename of [".env", ".npmrc", ".netrc", "id_rsa"]) {
      writeFileSync(join(root, filename), "sensitive-value-never-echoed");
      const result = readRepositoryManifest(root, { manifestPath: join(root, filename) });
      expect(result.manifest).toBeNull();
      expect(result.diagnostics.join()).toContain("Sensitive");
      expect(result.diagnostics.join()).not.toContain("sensitive-value-never-echoed");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("discovery refuses to save invalid unsupported proposals", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-empty-"));
  try {
    const result = await runRepositoryCommand({ action: "discover", root, cwd: root, json: true, write: true });
    expect(result.ok).toBe(false);
    expect(existsSync(join(root, "forge.manifest.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("relative roots use the supplied cwd and manifest paths reject control characters and streams", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-relative-"));
  try {
    mkdirSync(join(root, "app"));
    expect(await resolveRepositoryRoot({ cwd: root, root: "app" })).toBe(join(root, "app"));
    for (const path of ["app:stream", "app\u0000", "app\nname"]) expect(validateRepositoryManifest({
      ...manifest, components: [{ id: "app", root: path, adapters: ["java"] }],
    }).manifest).toBeNull();
    expect((await runRepositoryCommand({ action: "context", cwd: root, root, json: true, write: true })).ok).toBe(false);
    expect((await runRepositoryCommand({ action: "discover", cwd: root, root, json: true, write: false, output: "unused.json" })).ok).toBe(false);
    expect(existsSync(join(root, "unused.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI parses bounded read/write operations and rejects ignored flags", () => {
  const args = ["repository", "context", "--root", "C:/target", "--query", "routes", "--snapshot-id", "abc", "--json"];
  expect(hasUnknownOption(args)).toBeNull();
  expect(parseCli(args).command).toMatchObject({ kind: "repository", options: { action: "context", query: "routes", write: false } });
  expect(parseCli(["manifest", "discover", "--json"]).command).toMatchObject({ kind: "repository", options: { action: "discover" } });
  expect(parseCli(["repository", "context", "--write"]).command).toBeNull();
  expect(parseCli(["repository", "analyze", "--limit", "NaN"]).command).toBeNull();
  expect(parseCli(["repository", "analyze", "--force"]).command).toBeNull();
  expect(parseCli(["cair", "query", "Q ST", "--root", "--json"]).errors.length).toBeGreaterThan(0);
  expect(parseCli(["cair", "action", "A CREATE.FILE path=x.ts body=x", "--root", "other", "--json"]).command).toMatchObject({ options: { action: "A CREATE.FILE path=x.ts body=x", root: "other" } });
});

test("discovery is no-write by default and refuses overwriting user manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-discover-"));
  try {
    writeFileSync(join(root, "pom.xml"), "<project><artifactId>api</artifactId></project>");
    const options = { action: "discover" as const, cwd: root, root, write: false, json: true };
    expect((await runRepositoryCommand(options)).ok).toBe(true);
    expect(existsSync(join(root, ".forge"))).toBe(false);
    expect(existsSync(join(root, "forge.manifest.json"))).toBe(false);
    expect((await runRepositoryCommand({ ...options, write: true })).ok).toBe(true);
    const first = readFileSync(join(root, "forge.manifest.json"), "utf8");
    expect((await runRepositoryCommand({ ...options, write: true })).ok).toBe(false);
    expect(readFileSync(join(root, "forge.manifest.json"), "utf8")).toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
