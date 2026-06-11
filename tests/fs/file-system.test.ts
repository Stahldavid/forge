import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryFileSystem,
  NodeFileSystem,
} from "../../src/forge/compiler/fs/index.ts";
import type { FileSystem } from "../../src/forge/compiler/fs/index.ts";

/**
 * The same behavioural contract is run against both backends so the in-memory
 * double stays faithful to the Node implementation.
 */
function contract(name: string, makeRoot: () => { fs: FileSystem; root: string }) {
  describe(`FileSystem contract: ${name}`, () => {
    let fs: FileSystem;
    let root: string;

    beforeEach(() => {
      const made = makeRoot();
      fs = made.fs;
      root = made.root;
    });

    test("write then read round-trips", () => {
      const path = `${root}/a/b/file.txt`;
      expect(fs.readText(path)).toBeNull();
      fs.writeText(path, "hello");
      expect(fs.readText(path)).toBe("hello");
    });

    test("exists reflects files and implied directories", () => {
      const path = `${root}/dir/nested/file.ts`;
      fs.writeText(path, "x");
      expect(fs.exists(path)).toBe(true);
      expect(fs.exists(`${root}/dir`)).toBe(true);
      expect(fs.exists(`${root}/dir/nested`)).toBe(true);
      expect(fs.exists(`${root}/dir/missing`)).toBe(false);
    });

    test("isDirectory distinguishes files from directories", () => {
      const file = `${root}/d/f.ts`;
      fs.writeText(file, "x");
      expect(fs.isDirectory(`${root}/d`)).toBe(true);
      expect(fs.isDirectory(file)).toBe(false);
    });

    test("readDir lists immediate children only", () => {
      fs.writeText(`${root}/proj/one.ts`, "1");
      fs.writeText(`${root}/proj/two.ts`, "2");
      fs.writeText(`${root}/proj/sub/three.ts`, "3");
      const names = fs
        .readDir(`${root}/proj`)
        .map((e) => `${e.name}:${e.isDirectory ? "d" : "f"}`)
        .sort();
      expect(names).toEqual(["one.ts:f", "sub:d", "two.ts:f"]);
    });

    test("readDir on a missing directory returns empty", () => {
      expect(fs.readDir(`${root}/nope`)).toEqual([]);
    });

    test("rename moves a file", () => {
      fs.writeText(`${root}/x/old.ts`, "data");
      fs.rename(`${root}/x/old.ts`, `${root}/x/new.ts`);
      expect(fs.readText(`${root}/x/old.ts`)).toBeNull();
      expect(fs.readText(`${root}/x/new.ts`)).toBe("data");
    });

    test("remove deletes a file", () => {
      const path = `${root}/y/gone.ts`;
      fs.writeText(path, "bye");
      fs.remove(path);
      expect(fs.exists(path)).toBe(false);
    });

    test("remove deletes a directory subtree", () => {
      fs.writeText(`${root}/tree/a.ts`, "a");
      fs.writeText(`${root}/tree/sub/b.ts`, "b");
      fs.remove(`${root}/tree`);
      expect(fs.exists(`${root}/tree/a.ts`)).toBe(false);
      expect(fs.exists(`${root}/tree/sub/b.ts`)).toBe(false);
    });

    test("remove on a missing path is a no-op", () => {
      expect(() => fs.remove(`${root}/never`)).not.toThrow();
    });

    test("mkdirp makes an empty directory exist", () => {
      fs.mkdirp(`${root}/empty/dir`);
      expect(fs.isDirectory(`${root}/empty/dir`)).toBe(true);
    });

    test("copy duplicates a file", () => {
      fs.writeText(`${root}/src/a.ts`, "A");
      fs.copy(`${root}/src/a.ts`, `${root}/dst/a.ts`);
      expect(fs.readText(`${root}/dst/a.ts`)).toBe("A");
      expect(fs.readText(`${root}/src/a.ts`)).toBe("A");
    });

    test("copy duplicates a directory subtree", () => {
      fs.writeText(`${root}/tree/a.ts`, "a");
      fs.writeText(`${root}/tree/sub/b.ts`, "b");
      fs.copy(`${root}/tree`, `${root}/copy`);
      expect(fs.readText(`${root}/copy/a.ts`)).toBe("a");
      expect(fs.readText(`${root}/copy/sub/b.ts`)).toBe("b");
    });

    test("appendText creates then appends", () => {
      const path = `${root}/log/out.txt`;
      fs.appendText(path, "one\n");
      fs.appendText(path, "two\n");
      expect(fs.readText(path)).toBe("one\ntwo\n");
    });

    test("makeTempDir returns a fresh existing directory", () => {
      const a = fs.makeTempDir(`${root}/tmp/run-`);
      const b = fs.makeTempDir(`${root}/tmp/run-`);
      expect(a).not.toBe(b);
      expect(fs.isDirectory(a)).toBe(true);
      expect(fs.isDirectory(b)).toBe(true);
    });
  });
}

const tempDirs: string[] = [];

contract("NodeFileSystem", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-fs-"));
  tempDirs.push(root);
  return { fs: new NodeFileSystem(), root: root.replace(/\\/g, "/") };
});

contract("InMemoryFileSystem", () => ({
  fs: new InMemoryFileSystem(),
  root: "/ws",
}));

describe("InMemoryFileSystem specifics", () => {
  test("constructor seeds initial files", () => {
    const fs = new InMemoryFileSystem({
      "/ws/src/a.ts": "A",
      "/ws/src/b.ts": "B",
    });
    expect(fs.readText("/ws/src/a.ts")).toBe("A");
    expect(fs.readDir("/ws/src").map((e) => e.name)).toEqual(["a.ts", "b.ts"]);
  });

  test("normalises backslashes and trailing slashes", () => {
    const fs = new InMemoryFileSystem();
    fs.writeText("C:\\ws\\src\\a.ts", "A");
    expect(fs.readText("C:/ws/src/a.ts")).toBe("A");
    expect(fs.isDirectory("C:/ws/src/")).toBe(true);
  });

  test("snapshot returns all stored files", () => {
    const fs = new InMemoryFileSystem({ "/a.ts": "1" });
    fs.writeText("/b.ts", "2");
    expect(fs.snapshot()).toEqual({ "/a.ts": "1", "/b.ts": "2" });
  });

  test("renaming a directory relocates its subtree", () => {
    const fs = new InMemoryFileSystem({
      "/ws/old/a.ts": "a",
      "/ws/old/sub/b.ts": "b",
    });
    fs.rename("/ws/old", "/ws/new");
    expect(fs.readText("/ws/new/a.ts")).toBe("a");
    expect(fs.readText("/ws/new/sub/b.ts")).toBe("b");
    expect(fs.exists("/ws/old/a.ts")).toBe(false);
  });
});

// Clean up node temp dirs after the whole file finishes.
process.on("exit", () => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});
