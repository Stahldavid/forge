import { test, expect, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, open } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { stableStringify } from "../../src/forge/agent-fabric/canonical.ts";
import { captureManagedArtifact, captureManagedBase, prepareManagedWorkspace, publishManagedArtifacts, previewManagedArtifacts, confirmManagedPublication } from "../../src/forge/agent-fabric/managed-workspace.ts";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-managed-test-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await mkdir(join(root, "src")); await writeFile(join(root, "src", "a.txt"), "base"); await writeFile(join(root, "src", "remove.txt"), "remove");
  await writeFile(join(root, "other.txt"), "unrelated"); await writeFile(join(root, ".gitignore"), "*.ignored\n");
  git("add", "."); git("commit", "-qm", "base"); return { root, git };
}
test("captures dirty staged/deleted/untracked scope without altering user index, publishes cumulative dependent artifacts", async () => {
  const { root, git } = await fixture();
  try {
    await writeFile(join(root, "src", "a.txt"), "staged"); git("add", "src/a.txt");
    await writeFile(join(root, "src", "a.txt"), "actual dirty"); await rm(join(root, "src", "remove.txt"));
    await writeFile(join(root, "src", "new.txt"), "untracked"); await writeFile(join(root, "other.txt"), "user unrelated dirt");
    const index = git("diff", "--cached"), status = git("status", "--porcelain"), base = await captureManagedBase(root, "run", ["src"]);
    expect(git("status", "--porcelain")).toBe(status); expect(git("diff", "--cached")).toBe(index);
    const first = await prepareManagedWorkspace(base, "first", []);
    expect(await readFile(join(first.directory, "src", "a.txt"), "utf8")).toBe("actual dirty");
    expect(await readFile(join(first.directory, "src", "new.txt"), "utf8")).toBe("untracked");
    expect(await readFile(join(first.directory, "other.txt"), "utf8")).toBe("unrelated");
    await writeFile(join(first.directory, "src", "a.txt"), "first result");
    const artifact1 = JSON.parse(stableStringify(await captureManagedArtifact(base, first.directory, ["src"], first.inputDigest)));
    const second = await prepareManagedWorkspace(JSON.parse(stableStringify(base)), "second", [artifact1]);
    expect(await readFile(join(second.directory, "src", "a.txt"), "utf8")).toBe("first result");
    await writeFile(join(second.directory, "src", "a.txt"), "second result"); await rm(join(second.directory, "src", "new.txt"));
    const artifact2 = await captureManagedArtifact(base, second.directory, ["src"], second.inputDigest);
    expect(artifact2.files.find(file => file.path === "src/new.txt")!.contentBase64).toBeNull();
    const preview = await previewManagedArtifacts(base, [artifact1, artifact2]);
    expect(await confirmManagedPublication(base, [artifact1, artifact2])).toBe(false);
    expect(await publishManagedArtifacts(base, [artifact1, artifact2])).toEqual(preview);
    expect(preview.changedFiles).toEqual(["src/a.txt", "src/new.txt"]);
    expect(await confirmManagedPublication(base, [artifact1, artifact2])).toBe(true);
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("second result");
    expect(await readFile(join(root, "other.txt"), "utf8")).toBe("user unrelated dirt"); expect(git("diff", "--cached")).toBe(index);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("size bounds and forged artifact digests fail before source mutation", async () => {
  const { root } = await fixture(); try {
    const base = await captureManagedBase(root, "bounded", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    await writeFile(join(workspace.directory, "src", "a.txt"), "new");
    const artifact = await captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest); artifact.files[0].contentBase64 = Buffer.from("tampered").toString("base64");
    await expect(publishManagedArtifacts(base, [artifact])).rejects.toThrow("artifact digest");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("base");
    await writeFile(join(root, "src", "big.txt"), Buffer.alloc(16 * 1024 * 1024 + 1));
    await expect(captureManagedBase(root, "oversize", ["src"])).rejects.toThrow("size bound");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("generated graph-sized baseline files are allowed while changed artifacts remain bounded to eight MiB", async () => {
  const { root } = await fixture(); try {
    await writeFile(join(root, "src", "graph.json"), Buffer.alloc(9 * 1024 * 1024, 65));
    const base = await captureManagedBase(root, "graph", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    expect((await captureManagedArtifact(base, workspace.directory, [], workspace.inputDigest)).files).toEqual([]);
    await writeFile(join(workspace.directory, "src", "graph.json"), Buffer.alloc(9 * 1024 * 1024, 66));
    await expect(captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest)).rejects.toThrow("excessive base64");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("large readonly Git assets stay fingerprinted, compose scoped changes and reject tampering without inflating metadata", async () => {
  const { root, git } = await fixture(); const clones: string[] = [];
  const size = 17 * 1024 * 1024;
  const changeFirstByte = async (path: string, value: number) => { const handle = await open(path, "r+"); try { await handle.write(Buffer.from([value]), 0, 1, 0); } finally { await handle.close(); } };
  try {
    await mkdir(join(root, "assets"));
    // Total immutable assets exceed the editable 128 MiB budget, while each
    // individual asset exceeds the old 16 MiB file limit.
    const bytes = Buffer.alloc(size, 65);
    for (let i = 0; i < 8; i++) await writeFile(join(root, "assets", `asset-${i}.bin`), bytes);
    git("add", "assets"); git("commit", "-qm", "large readonly assets");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const base = await captureManagedBase(root, "large-readonly", ["src"]); clones.push(base.baselineDirectory);
    const first = await prepareManagedWorkspace(base, "first", []); clones.push(first.directory);
    const metadataPath = join(first.directory, ".git", "forge-managed-input.json");
    const metadataText = await readFile(metadataPath, "utf8"), metadata = JSON.parse(metadataText);
    const assets = metadata.input.files.filter((file: { path: string }) => file.path.startsWith("assets/"));
    expect(assets).toHaveLength(8); expect(metadataText.length).toBeLessThan(20_000);
    expect(assets.every((file: { readonlySize?: number; contentBase64?: string; digest: string }) => file.readonlySize === size && file.contentBase64 === undefined && file.digest === digest)).toBe(true);
    expect((await captureManagedArtifact(base, first.directory, [], first.inputDigest)).files).toEqual([]);

    await writeFile(join(first.directory, "src", "a.txt"), "scoped result");
    const artifact = await captureManagedArtifact(base, first.directory, ["src"], first.inputDigest);
    expect(artifact.files.map(file => file.path)).toEqual(["src/a.txt"]);
    const second = await prepareManagedWorkspace(base, "second", [artifact]); clones.push(second.directory);
    expect(await readFile(join(second.directory, "src", "a.txt"), "utf8")).toBe("scoped result");
    expect(createHash("sha256").update(await readFile(join(second.directory, "assets", "asset-0.bin"))).digest("hex")).toBe(digest.slice(7));
    expect((await publishManagedArtifacts(base, [artifact])).changedFiles).toEqual(["src/a.txt"]);
    expect(createHash("sha256").update(await readFile(join(root, "assets", "asset-0.bin"))).digest("hex")).toBe(digest.slice(7));

    metadata.input.files.find((file: { path: string }) => file.path === "assets/asset-0.bin").readonlySize++;
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(captureManagedArtifact(base, first.directory, ["src"], first.inputDigest)).rejects.toThrow("coordinator digest");
    await writeFile(metadataPath, metadataText);
    await changeFirstByte(join(first.directory, "assets", "asset-0.bin"), 66);
    await expect(captureManagedArtifact(base, first.directory, ["src"], first.inputDigest)).rejects.toThrow("unauthorized change: assets/asset-0.bin");
    await changeFirstByte(join(first.directory, "assets", "asset-0.bin"), 65);
    await writeFile(join(first.directory, "src", "new-large.bin"), bytes);
    await expect(captureManagedArtifact(base, first.directory, ["src"], first.inputDigest)).rejects.toThrow("file size bound");
    await expect(captureManagedBase(root, "editable-large", ["assets/asset-0.bin"])).rejects.toThrow("file size bound");
    await changeFirstByte(join(base.baselineDirectory, "assets", "asset-0.bin"), 66);
    await expect(prepareManagedWorkspace(base, "tampered", [])).rejects.toThrow("immutable baseline modified");
  } finally {
    for (const directory of clones) {
      const target = resolve(dirname(directory));
      if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !/^forge-managed-(?:base|attempt)-/.test(basename(target))) throw new Error("Unsafe owned clone cleanup");
      await rm(target, { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
test("rejects conflicting parallel writers and changed root before any publication", async () => {
  const { root } = await fixture(); try {
    const base = await captureManagedBase(root, "run", ["src"]), one = await prepareManagedWorkspace(base, "one", []), two = await prepareManagedWorkspace(base, "two", []);
    await writeFile(join(one.directory, "src", "a.txt"), "one"); await writeFile(join(two.directory, "src", "a.txt"), "two");
    const a = await captureManagedArtifact(base, one.directory, ["src"], one.inputDigest), b = await captureManagedArtifact(base, two.directory, ["src"], two.inputDigest);
    await expect(publishManagedArtifacts(base, [a, b])).rejects.toThrow("conflicting beforeimage");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("base");
    await writeFile(join(root, "src", "a.txt"), "concurrent user edit");
    await expect(publishManagedArtifacts(base, [a])).rejects.toThrow("source changed");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("concurrent user edit");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("rejects tracked and ignored out-of-scope changes, path escapes and modified baseline", async () => {
  const { root } = await fixture(); try {
    for (const scope of [["../escape"], [".git"], ["C:/escape"], ["src\\a.txt"]]) await expect(captureManagedBase(root, "run", scope)).rejects.toThrow();
    const base = await captureManagedBase(root, "run", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    expect((await captureManagedArtifact(base, workspace.directory, [], workspace.inputDigest)).files).toEqual([]);
    await writeFile(join(workspace.directory, "other.txt"), "outside");
    await expect(captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest)).rejects.toThrow("unauthorized");
    await writeFile(join(workspace.directory, "other.txt"), "unrelated"); await writeFile(join(workspace.directory, "new.ignored"), "ignored");
    await expect(captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest)).rejects.toThrow("unauthorized");
    await writeFile(join(base.baselineDirectory, "src", "a.txt"), "modified");
    await expect(prepareManagedWorkspace(base, "next", [])).rejects.toThrow("baseline modified");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("rejects symlink traversal when supported by host", async () => {
  const { root } = await fixture(); try {
    try { await symlink(join(root, "other.txt"), join(root, "src", "link.txt"), "file"); } catch (error) { if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) return; throw error; }
    await expect(captureManagedBase(root, "run", ["src"])).rejects.toThrow("symlink");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("coordinator input digest rejects a forged worker metadata beforeimage", async () => {
  const { root } = await fixture(); try {
    const base = await captureManagedBase(root, "run", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    await writeFile(join(workspace.directory, "other.txt"), "forged out-of-scope edit");
    const metadataPath = join(workspace.directory, ".git", "forge-managed-input.json"), metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const other = metadata.input.files.find((file: { path: string }) => file.path === "other.txt");
    other.contentBase64 = Buffer.from("forged out-of-scope edit").toString("base64"); other.digest = `sha256:${createHash("sha256").update("forged out-of-scope edit").digest("hex")}`;
    metadata.input.digest = `sha256:${createHash("sha256").update(JSON.stringify(metadata.input.files.map(({ path, digest, mode }: { path: string; digest: string; mode: number }) => ({ path, digest, mode })))).digest("hex")}`;
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(captureManagedArtifact(base, workspace.directory, [], workspace.inputDigest)).rejects.toThrow("coordinator digest");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("publication rollback preserves a concurrent external edit and reports uncertain output", async () => {
  const { root } = await fixture(); let renameSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const base = await captureManagedBase(root, "run", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    await writeFile(join(workspace.directory, "src", "a.txt"), "agent a"); await writeFile(join(workspace.directory, "src", "remove.txt"), "agent b");
    const artifact = await captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest), originalRename = fsPromises.rename;
    renameSpy = spyOn(fsPromises, "rename").mockImplementation(async (source, target) => {
      if (String(target) === join(root, "src", "remove.txt")) { await writeFile(join(root, "src", "a.txt"), "external concurrent edit"); throw new Error("injected write failure"); }
      return originalRename(source, target);
    });
    await expect(publishManagedArtifacts(base, [artifact])).rejects.toThrow("uncertain publication");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("external concurrent edit");
    expect(await readFile(join(root, "src", "remove.txt"), "utf8")).toBe("remove");
  } finally { renameSpy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("normal publication failure rolls back already applied source changes", async () => {
  const { root } = await fixture(); let renameSpy: ReturnType<typeof spyOn> | undefined;
  try {
    const base = await captureManagedBase(root, "run", ["src"]), workspace = await prepareManagedWorkspace(base, "attempt", []);
    await writeFile(join(workspace.directory, "src", "a.txt"), "agent a"); await writeFile(join(workspace.directory, "src", "remove.txt"), "agent b");
    const artifact = await captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest), originalRename = fsPromises.rename;
    renameSpy = spyOn(fsPromises, "rename").mockImplementation(async (source, target) => {
      if (String(target) === join(root, "src", "remove.txt")) throw new Error("ordinary failure");
      return originalRename(source, target);
    });
    await expect(publishManagedArtifacts(base, [artifact])).rejects.toThrow("ordinary failure");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("base");
    expect(await readFile(join(root, "src", "remove.txt"), "utf8")).toBe("remove");
  } finally { renameSpy?.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60_000);
test("readonly context changes block publication and confirmation, including tracked context deletions", async () => {
  const { root, git } = await fixture(); try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "context", version: "1.0.0" })); git("add", "package.json"); git("commit", "-qm", "metadata");
    await rm(join(root, "package.json"));
    const base = await captureManagedBase(root, "context", ["src"]), workspace = await prepareManagedWorkspace(base, "check", []);
    expect(base.contextScope).toContain("package.json");
    expect((await fsPromises.readdir(workspace.directory)).includes("package.json")).toBe(false);
    await writeFile(join(workspace.directory, "src", "a.txt"), "agent change");
    const artifact = await captureManagedArtifact(base, workspace.directory, ["src"], workspace.inputDigest);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "context", version: "2.0.0" }));
    await expect(publishManagedArtifacts(base, [artifact])).rejects.toThrow("readonly environment context");
    expect(await confirmManagedPublication(base, [artifact])).toBe(false);
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("base");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
