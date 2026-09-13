import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";

const temporaryRoots: string[] = [];
const guardScript = join(process.cwd(), "scripts", "release-channel-guard.mjs");

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "forge-release-channel-"));
  temporaryRoots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runGuard(mode: "publish" | "version", root: string) {
  return spawnSync(process.execPath, [guardScript, mode, root], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("release channel guard", () => {
  test("repository alpha line is represented by Changesets pre mode", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
      version: string;
      publishConfig?: { tag?: string };
    };
    const pre = JSON.parse(readFileSync(join(process.cwd(), ".changeset", "pre.json"), "utf8")) as {
      mode?: string;
      tag?: string;
      initialVersions?: Record<string, string>;
      changesets?: string[];
    };

    expect(pkg.name).toBe("forgeos");
    expect(pkg.version).toMatch(/^0\.1\.0-alpha\.\d+$/);
    expect(pkg.publishConfig?.tag).toBe("alpha");
    expect(pre.mode).toBe("pre");
    expect(pre.tag).toBe("alpha");
    expect(pre.initialVersions?.forgeos).toBe("0.1.0-alpha.63");
    expect(pre.initialVersions?.["create-forgeos-app"]).toBe("0.1.0-alpha.5");
    expect(pre.initialVersions?.["eslint-plugin-forge"]).toBe("0.0.0");
    expect(Array.isArray(pre.changesets)).toBe(true);

    const versionGuard = runGuard("version", process.cwd());
    expect(versionGuard.status, `${versionGuard.stdout}\n${versionGuard.stderr}`).toBe(0);
    const publishGuard = runGuard("publish", process.cwd());
    expect(publishGuard.status, `${publishGuard.stdout}\n${publishGuard.stderr}`).toBe(0);
  });

  test("refuses a stable version on the alpha publish channel", () => {
    const root = temporaryRoot();
    writeJson(join(root, "package.json"), {
      name: "forgeos",
      version: "0.1.0",
      publishConfig: { tag: "alpha" },
    });

    const result = runGuard("publish", root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match publishConfig.tag=alpha");
    expect(result.stderr).toContain("expected a -alpha.* prerelease");
  });

  test("refuses prerelease versioning when Changesets pre mode is absent", () => {
    const root = temporaryRoot();
    writeJson(join(root, "package.json"), {
      name: "forgeos",
      version: "0.1.0-alpha.63",
      publishConfig: { tag: "alpha" },
    });

    const result = runGuard("version", root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unable to read Changesets prerelease state");
  });

  test("Changesets minor versioning advances alpha.63 to alpha.64 in pre mode", () => {
    const root = temporaryRoot();
    const changesetDir = join(root, ".changeset");
    mkdirSync(changesetDir, { recursive: true });
    writeJson(join(root, "package.json"), {
      name: "forgeos",
      version: "0.1.0-alpha.63",
    });
    writeJson(join(changesetDir, "config.json"), {
      changelog: false,
      commit: false,
      fixed: [],
      linked: [],
      access: "public",
      baseBranch: "main",
      updateInternalDependencies: "patch",
      ignore: [],
    });
    writeJson(join(changesetDir, "pre.json"), {
      mode: "pre",
      tag: "alpha",
      initialVersions: { forgeos: "0.1.0-alpha.63" },
      changesets: [],
    });
    writeFileSync(
      join(changesetDir, "alpha-bump.md"),
      `---\n"forgeos": minor\n---\n\nExercise prerelease versioning.\n`,
      "utf8",
    );

    const changesetCli = join(process.cwd(), "node_modules", "@changesets", "cli", "bin.js");
    expect(existsSync(changesetCli)).toBe(true);
    const result = spawnSync(process.execPath, [changesetCli, "version"], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const versioned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(versioned.version).toBe("0.1.0-alpha.64");
    const nextPre = JSON.parse(readFileSync(join(changesetDir, "pre.json"), "utf8")) as {
      mode: string;
      tag: string;
      changesets: string[];
    };
    expect(nextPre.mode).toBe("pre");
    expect(nextPre.tag).toBe("alpha");
    expect(nextPre.changesets).toContain("alpha-bump");
  });
});
