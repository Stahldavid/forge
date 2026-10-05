import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const installer = resolve("scripts/install-agent-fabric-skill.mjs");
const packagedSkill = resolve(".agents/skills/forge-agent-fabric");
function isolated(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "forge-portable-skill-test-"));
  try { run(root); } finally {
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("Unexpected cleanup target");
    rmSync(root, { recursive: true, force: true });
  }
}
function invoke(args: string[], script = installer) {
  // Bun's process.execPath is Bun, so select Node explicitly on both Windows and POSIX.
  return spawnSync("node", [script, ...args], { encoding: "utf8", windowsHide: true });
}
function install(root: string, extra: string[] = [], script = installer) {
  const fake = join(root, "runtime.mjs");
  if (!existsSync(fake)) writeFileSync(fake, "console.log(JSON.stringify({cwd:process.cwd(),argv:process.argv.slice(2)}));");
  return invoke(["--dest", join(root, "skills"), "--runtime", fake, ...extra], script);
}

test("portable installer is idempotent and backs up edits to owned packaged files", () => isolated((root) => {
  const first = install(root); expect(first.status).toBe(0);
  const target = join(root, "skills/forge-agent-fabric");
  expect(existsSync(join(target, "runtime.json"))).toBe(true);
  expect(existsSync(join(target, "installation.json"))).toBe(true);
  const second = install(root); expect(second.status).toBe(0);
  expect(JSON.parse(second.stdout).unchanged).toBe(true);
  expect(JSON.parse(second.stdout).backup).toBeUndefined();
  writeFileSync(join(target, "SKILL.md"), "locally edited skill");
  const updated = install(root); expect(updated.status).toBe(0);
  const result = JSON.parse(updated.stdout);
  expect(result.unchanged).toBe(false);
  expect(readFileSync(join(result.backup, "SKILL.md"), "utf8")).toBe("locally edited skill");
  expect(result.backup.startsWith(join(root, "skills") + sep)).toBe(false);
  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain("Forge Agent Fabric");
}));

test("portable helper forwards arguments from the target Git root outside runtime checkout", () => isolated((root) => {
  expect(install(root).status).toBe(0);
  const project = join(root, "external project"); mkdirSync(project);
  execFileSync("git", ["init", "-q", project], { windowsHide: true });
  mkdirSync(join(project, "nested"));
  const helper = join(root, "skills/forge-agent-fabric/scripts/fabric.mjs");
  const result = invoke(["--project", join(project, "nested"), "capabilities", "--json"], helper);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ cwd: project, argv: ["fabric", "capabilities", "--json"] });
  expect(invoke(["--project", root, "capabilities"], helper).status).toBe(1);
}));

test("portable installer preserves unknown skills and supports non-mutating dry run", () => isolated((root) => {
  const target = join(root, "skills/forge-agent-fabric"); mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "unmanaged skill");
  expect(install(root).status).toBe(1);
  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("unmanaged skill");
  expect(install(root, ["--replace", "--dry-run"]).status).toBe(0);
  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("unmanaged skill");
  const replaced = install(root, ["--replace"]); expect(replaced.status).toBe(0);
  expect(readFileSync(join(JSON.parse(replaced.stdout).backup, "SKILL.md"), "utf8")).toBe("unmanaged skill");
}));

test("portable installer rejects canonical source collisions and preserves relative symlinks", () => isolated((root) => {
  const packageRoot = join(root, "package"); mkdirSync(join(packageRoot, "scripts"), { recursive: true });
  mkdirSync(join(packageRoot, "bin"));
  cpSync(installer, join(packageRoot, "scripts/install-agent-fabric-skill.mjs"));
  const source = join(packageRoot, ".agents/skills/forge-agent-fabric"); cpSync(packagedSkill, source, { recursive: true });
  writeFileSync(join(packageRoot, "bin/forge.mjs"), "");
  const alias = join(root, "source-alias");
  symlinkSync(join(packageRoot, ".agents/skills"), alias, process.platform === "win32" ? "junction" : "dir");
  const script = join(packageRoot, "scripts/install-agent-fabric-skill.mjs");
  const collision = invoke(["--dest", alias, "--replace"], script);
  expect(collision.status).toBe(1);
  expect(collision.stderr).toContain("must differ");
  try { symlinkSync("SKILL.md", join(source, "skill-link.md"), "file"); } catch (error) {
    // Creating file symlinks can require Windows privileges; collision remains covered.
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
    throw error;
  }
  const result = install(root, [], script); expect(result.status).toBe(0);
  const link = join(root, "skills/forge-agent-fabric/skill-link.md");
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readlinkSync(link)).toBe("SKILL.md");
  expect(JSON.parse(install(root, [], script).stdout).unchanged).toBe(true);
}));
