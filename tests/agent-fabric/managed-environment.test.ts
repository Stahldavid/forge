import { test, expect, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { prepareManagedEnvironment, verifyManagedEnvironment, managedInstallEnvironment } from "../../src/forge/agent-fabric/managed-environment.ts";
import { captureManagedBase, prepareManagedWorkspace, captureManagedArtifact } from "../../src/forge/agent-fabric/managed-workspace.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-env-test-"));
  const manifest = { name: "managed-environment-fixture", version: "1.0.0", private: true, dependencies: { "is-number": "7.0.0" }, scripts: { postinstall: "node -e \"require('fs').writeFileSync('lifecycle-ran.txt','unsafe')\"" } };
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: manifest.name, version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: manifest.name, version: "1.0.0", dependencies: manifest.dependencies, hasInstallScript: true }, "node_modules/is-number": { version: "7.0.0", resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz", engines: { node: ">=0.12.0" } } } }));
  await writeFile(join(root, "source.txt"), "source");
  await writeFile(join(root, ".npmrc"), "//registry.npmjs.org/:_authToken=${PRIVATE_PACKAGE_TOKEN}\nregistry=https://invalid.example\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: "ignore" });
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid"); git("add", "."); git("commit", "-qm", "base");
  return root;
}
test("real frozen npm preparation ignores scripts/config secrets, cache deep-copies and coordinator digest detects tampering", async () => {
  const root = await fixture(), cache = await mkdtemp(join(tmpdir(), "forge-env-cache-test-"));
  try {
    const base = await captureManagedBase(root, "environment", ["source.txt"]), first = await prepareManagedWorkspace(base, "first", []);
    const projectConfig = await readFile(join(first.directory, ".npmrc"), "utf8");
    const environment = await prepareManagedEnvironment(first.directory, { cacheDirectory: cache, timeoutMs: 60000 });
    expect(environment.manager).toBe("npm"); expect(environment.cacheHit).toBe(false);
    expect(await readFile(join(first.directory, "node_modules", "is-number", "package.json"), "utf8")).toContain('"version": "7.0.0"');
    expect((await readdir(first.directory)).includes("lifecycle-ran.txt")).toBe(false);
    expect(await readFile(join(first.directory, ".npmrc"), "utf8")).toBe(projectConfig);
    expect((await captureManagedArtifact(base, first.directory, [], first.inputDigest, environment)).files).toEqual([]);
    const second = await prepareManagedWorkspace(base, "second", []), reused = await prepareManagedEnvironment(second.directory, { cacheDirectory: cache, timeoutMs: 60000 });
    expect(reused.cacheHit).toBe(true); expect(reused.dependencyDigest).toBe(environment.dependencyDigest);
    await writeFile(join(first.directory, "node_modules", "is-number", "index.js"), "modified worker dependency");
    await expect(verifyManagedEnvironment(environment)).rejects.toThrow("dependencies were modified");
    await expect(captureManagedArtifact(base, first.directory, [], first.inputDigest, environment)).rejects.toThrow("dependencies were modified");
    await verifyManagedEnvironment(reused);
    expect(await readFile(join(second.directory, "node_modules", "is-number", "index.js"), "utf8")).not.toContain("modified worker dependency");
  } finally { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
}, 120000);
test("non-Node/disabled preparation and ambiguous locks are explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-env-test-")); try {
    expect((await prepareManagedEnvironment(root)).manager).toBe("none");
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    expect((await prepareManagedEnvironment(root, { mode: "none" })).manager).toBe("none");
    await expect(prepareManagedEnvironment(root)).rejects.toThrow("deterministic frozen lockfile");
    await writeFile(join(root, "package-lock.json"), "{}"); await writeFile(join(root, "bun.lock"), "{}");
    await expect(prepareManagedEnvironment(root)).rejects.toThrow("ambiguous");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("installation environment omits provider and package tokens", () => {
  process.env.FORGE_PRIVATE_SECRET_FIXTURE = "must-never-pass";
  try { const env = managedInstallEnvironment("private-install-home"); expect(env.FORGE_PRIVATE_SECRET_FIXTURE).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined(); expect(env.NPM_TOKEN).toBeUndefined(); expect(env.HOME).toBe("private-install-home"); }
  finally { delete process.env.FORGE_PRIVATE_SECRET_FIXTURE; }
});
test("outside-scope dirty dependency manifests are immutable context and install the current working tree", async () => {
  const root = await fixture(), cache = await mkdtemp(join(tmpdir(), "forge-env-cache-test-"));
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")), lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    manifest.description = "working tree dependency context"; lock.packages[""].description = manifest.description;
    await writeFile(join(root, "package.json"), JSON.stringify(manifest)); await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
    const base = await captureManagedBase(root, "context", ["source.txt"]), workspace = await prepareManagedWorkspace(base, "check", []);
    expect(base.contextScope).toContain("package.json"); expect(base.contextScope).toContain("package-lock.json");
    expect(JSON.parse(await readFile(join(workspace.directory, "package.json"), "utf8")).description).toBe(manifest.description);
    const environment = await prepareManagedEnvironment(workspace.directory, { cacheDirectory: cache, timeoutMs: 60000 });
    expect((await captureManagedArtifact(base, workspace.directory, [], workspace.inputDigest, environment)).files).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
}, 120000);
test("real npm workspaces remain portable and isolated across cached cloned environments", async () => {
  const root = await fixture(), cache = await mkdtemp(join(tmpdir(), "forge-env-cache-test-"));
  try {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")), lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    manifest.workspaces = ["packages/*"]; manifest.dependencies["local-workspace"] = "file:packages/local";
    lock.packages[""].workspaces = manifest.workspaces; lock.packages[""].dependencies = manifest.dependencies;
    lock.packages["packages/local"] = { name: "local-workspace", version: "1.0.0" };
    lock.packages["node_modules/local-workspace"] = { resolved: "packages/local", link: true };
    await fsPromises.mkdir(join(root, "packages", "local"), { recursive: true });
    await writeFile(join(root, "packages", "local", "package.json"), JSON.stringify({ name: "local-workspace", version: "1.0.0", main: "index.js" }));
    await writeFile(join(root, "packages", "local", "index.js"), "module.exports = 41;\n");
    await writeFile(join(root, "package.json"), JSON.stringify(manifest)); await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
    execFileSync("git", ["-C", root, "add", "."], { windowsHide: true, stdio: "ignore" }); execFileSync("git", ["-C", root, "commit", "-qm", "workspace"], { windowsHide: true, stdio: "ignore" });
    const base = await captureManagedBase(root, "workspace", ["source.txt"]), first = await prepareManagedWorkspace(base, "first", []), second = await prepareManagedWorkspace(base, "second", []);
    const environment = await prepareManagedEnvironment(first.directory, { cacheDirectory: cache, timeoutMs: 60000 }), cached = await prepareManagedEnvironment(second.directory, { cacheDirectory: cache, timeoutMs: 60000 });
    expect(cached.cacheHit).toBe(true); expect(cached.dependencyDigest).toBe(environment.dependencyDigest);
    expect(execFileSync(process.execPath, ["-e", "console.log(require('local-workspace'))"], { cwd: second.directory, encoding: "utf8", windowsHide: true }).trim()).toBe("41");
    expect(await fsPromises.realpath(join(second.directory, "node_modules", "local-workspace"))).toBe(join(second.directory, "packages", "local"));
    expect((await captureManagedArtifact(base, second.directory, [], second.inputDigest, cached)).files).toEqual([]);
    await writeFile(join(first.directory, "packages", "local", "index.js"), "module.exports = 99;\n");
    expect(execFileSync(process.execPath, ["-e", "console.log(require('local-workspace'))"], { cwd: second.directory, encoding: "utf8", windowsHide: true }).trim()).toBe("41");
    expect(execFileSync(process.execPath, ["-e", "console.log(require('local-workspace'))"], { cwd: first.directory, encoding: "utf8", windowsHide: true }).trim()).toBe("99");
    await writeFile(join(root, "packages", "local", "index.js"), "module.exports = 77;\n");
    const changedBase = await captureManagedBase(root, "changed-workspace", ["source.txt", "packages/local"]), third = await prepareManagedWorkspace(changedBase, "third", []);
    const freshSourceCache = await prepareManagedEnvironment(third.directory, { cacheDirectory: cache, timeoutMs: 60000 });
    expect(freshSourceCache.cacheHit).toBe(true);
    expect(execFileSync(process.execPath, ["-e", "console.log(require('local-workspace'))"], { cwd: third.directory, encoding: "utf8", windowsHide: true }).trim()).toBe("77");
  } finally { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
}, 120000);
test("private install homes are cleaned on success and installation failure", async () => {
  const root = await fixture(), cache = await mkdtemp(join(tmpdir(), "forge-env-cache-test-")); let rmSpy: ReturnType<typeof spyOn> | undefined, renameSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const homes: string[] = [], originalRm = fsPromises.rm;
    rmSpy = spyOn(fsPromises, "rm").mockImplementation(async (path, options) => {
      if (String(path).includes("forge-managed-install-home-")) homes.push(String(path)); return originalRm(path, options);
    });
    await prepareManagedEnvironment(root, { cacheDirectory: cache, timeoutMs: 60000 });
    for (const home of homes) await expect(fsPromises.lstat(home)).rejects.toMatchObject({ code: "ENOENT" });
    const failed = await fixture();
    try { const manifest = JSON.parse(await readFile(join(failed, "package.json"), "utf8")); manifest.dependencies["is-number"] = "8.0.0"; await writeFile(join(failed, "package.json"), JSON.stringify(manifest)); await expect(prepareManagedEnvironment(failed, { cacheDirectory: cache, timeoutMs: 60000 })).rejects.toThrow("frozen npm install failed"); }
    finally { await rm(failed, { recursive: true, force: true }); }
    for (const home of homes) await expect(fsPromises.lstat(home)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(cache)).some(name => name.endsWith(".stage"))).toBe(false);
    const loserCache = join(cache, "loser-cache"), originalRename = fsPromises.rename;
    renameSpy = spyOn(fsPromises, "rename").mockImplementation(async (source, target) => {
      if (String(source).endsWith(".stage")) throw Object.assign(new Error("cache publication race lost"), { code: "EEXIST" });
      return originalRename(source, target);
    });
    await prepareManagedEnvironment(root, { cacheDirectory: loserCache, timeoutMs: 60000 });
    expect((await readdir(loserCache)).some(name => name.endsWith(".stage"))).toBe(false);
    expect(homes).toHaveLength(3);
    for (const home of homes) await expect(fsPromises.lstat(home)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { renameSpy?.mockRestore(); rmSpy?.mockRestore(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
}, 120000);
