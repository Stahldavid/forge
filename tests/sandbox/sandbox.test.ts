import { describe, expect, test, afterEach } from "bun:test";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import {
  clampSandboxLimits,
  defaultSandboxLimits,
  dockerRunFlags,
  emptyRuntimeExportShape,
  inspectExports,
  scrubEnv,
  secretLeakScan,
  serializeRuntimeExportShape,
  setChildRunner,
  setDockerRunner,
  assertJsonSerializable,
} from "../../src/forge/compiler/sandbox/index.ts";
import { RUNTIME_FIXTURE } from "./helpers.ts";
import { mkdirSync, rmSync } from "node:fs";
import { tempCacheDir } from "../package-graph/helpers.ts";

describe("sandbox backends", () => {
  afterEach(() => {
    setChildRunner(undefined);
    setDockerRunner(undefined);
  });

  test("none backend returns empty shape without diagnostics", async () => {
    const result = await inspectExports(
      RUNTIME_FIXTURE,
      defaultSandboxLimits("none"),
    );
    expect(result.shape).toEqual(emptyRuntimeExportShape());
    expect(result.runtimeUsed).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  test("child backend returns JSON-serializable export shape", async () => {
    const result = await inspectExports(
      RUNTIME_FIXTURE,
      defaultSandboxLimits("child"),
    );

    if (result.runtimeUsed) {
      assertJsonSerializable(result.shape);
      const names = result.shape.entrypoints[0]?.exports.map((e) => e.name) ?? [];
      expect(names).toContain("greet");
      expect(names).toContain("Greeter");
      expect(result.diagnostics).toEqual([]);
    } else {
      expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
    }
  });

  test("timeout falls back with FORGE_SANDBOX_LIMIT", async () => {
    setChildRunner({
      async run() {
        return {
          stdout: "",
          stderr: "",
          exitCode: null,
          timedOut: true,
          oomKilled: false,
          startFailed: false,
        };
      },
    });

    const result = await inspectExports(
      RUNTIME_FIXTURE,
      defaultSandboxLimits("child"),
    );

    expect(result.runtimeUsed).toBe(false);
    expect(result.shape).toEqual(emptyRuntimeExportShape());
    expect(result.diagnostics.some((d) => d.code === "FORGE_SANDBOX_LIMIT")).toBe(
      true,
    );
  });

  test("abnormal start falls back with warning and no partial data", async () => {
    setChildRunner({
      async run() {
        return {
          stdout: '{"entrypoints":[{"subpath":".","exports":[{"name":"partial","kind":"const"}]}]}',
          stderr: "spawn failed",
          exitCode: null,
          timedOut: false,
          oomKilled: false,
          startFailed: true,
        };
      },
    });

    const result = await inspectExports(
      RUNTIME_FIXTURE,
      defaultSandboxLimits("child"),
    );

    expect(result.runtimeUsed).toBe(false);
    expect(result.shape).toEqual(emptyRuntimeExportShape());
    expect(result.diagnostics.some((d) => d.code === "FORGE_SANDBOX_ABNORMAL")).toBe(
      true,
    );
  });

  test("secret leak scan withholds runtime result", async () => {
    setChildRunner({
      async run() {
        return {
          stdout: JSON.stringify({
            entrypoints: [
              {
                subpath: ".",
                exports: [{ name: "sk_live_leaked_value", kind: "const" }],
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          oomKilled: false,
          startFailed: false,
        };
      },
    });

    const result = await inspectExports(
      RUNTIME_FIXTURE,
      defaultSandboxLimits("child"),
    );

    expect(result.runtimeUsed).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "FORGE_SECRET_LEAK")).toBe(
      true,
    );
  });

  test("docker flags include network none, read-only, memory, pids, cap-drop", () => {
    const flags = dockerRunFlags(defaultSandboxLimits("docker"));
    expect(flags).toContain("--network");
    expect(flags).toContain("none");
    expect(flags).toContain("--read-only");
    expect(flags).toContain("--memory");
    expect(flags).toContain("256m");
    expect(flags).toContain("--pids-limit");
    expect(flags).toContain("--cap-drop");
    expect(flags).toContain("ALL");
  });

  test("limits are clamped to 30s and 256MB", () => {
    const limits = clampSandboxLimits({
      backend: "docker",
      timeoutMs: 120_000,
      memoryMb: 1024,
      network: false,
      filesystem: "read-only",
      allowPostinstall: false,
    });

    expect(limits.timeoutMs).toBe(30_000);
    expect(limits.memoryMb).toBe(256);
  });
});

describe("scrubEnv", () => {
  test("allowlists safe vars and removes secret-named keys", () => {
    const scrubbed = scrubEnv(
      {
        PATH: "/usr/bin",
        STRIPE_SECRET_KEY: "sk_live_should_not_pass",
        API_KEY: "also-secret",
        HOME: "/home/dev",
      },
      { dotEnvValues: ["from-dotenv-value"] },
    );

    expect(scrubbed.PATH).toBe("/usr/bin");
    expect(scrubbed.HOME).toBe("/home/dev");
    expect(scrubbed.STRIPE_SECRET_KEY).toBeUndefined();
    expect(scrubbed.API_KEY).toBeUndefined();
    expect(Object.values(scrubbed)).not.toContain("from-dotenv-value");
  });
});

describe("secretLeakScan", () => {
  test("detects token prefixes and known secret values", () => {
    const serialized = serializeRuntimeExportShape({
      entrypoints: [
        {
          subpath: ".",
          exports: [{ name: "token", kind: "const" }],
        },
      ],
    });

    const withPrefix = `${serialized} sk_live_abc123`;
    expect(secretLeakScan(withPrefix).hasLeak).toBe(true);

    const withKnown = secretLeakScan("plain", {
      knownSecretValues: ["super-secret-value"],
    });
    expect(
      secretLeakScan("contains super-secret-value", {
        knownSecretValues: ["super-secret-value"],
      }).hasLeak,
    ).toBe(true);
    expect(withKnown.hasLeak).toBe(false);
  });
});

describe("PackageGraphCompiler runtimeInspect routing", () => {
  test("routes runtimeInspect to sandbox and keeps static when backend is none", async () => {
    const cacheDir = tempCacheDir("runtime-none");
    mkdirSync(cacheDir, { recursive: true });

    try {
      const compiler = new PackageGraphCompiler();
      const api = await compiler.analyze({
        name: "zod",
        version: "3.24.0",
        packageManager: "bun",
        installPath: RUNTIME_FIXTURE.installPath.replace("runtime-lib", "zod"),
      }, {
        runtimeInspect: true,
        sandboxBackend: "none",
        resolutionMode: "nodenext",
        cacheDir,
      });

      expect(api.source).toBe("static");
      expect(api.runtimeShape).toBeUndefined();
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test("merges runtime shape when child inspection succeeds", async () => {
    setChildRunner({
      async run() {
        return {
          stdout: JSON.stringify({
            entrypoints: [
              {
                subpath: ".",
                exports: [
                  { name: "greet", kind: "function" },
                  { name: "VERSION", kind: "const" },
                ],
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
          timedOut: false,
          oomKilled: false,
          startFailed: false,
        };
      },
    });

    const cacheDir = tempCacheDir("runtime-child");
    mkdirSync(cacheDir, { recursive: true });

    try {
      const compiler = new PackageGraphCompiler();
      const api = await compiler.analyze(RUNTIME_FIXTURE, {
        runtimeInspect: true,
        sandboxBackend: "child",
        resolutionMode: "nodenext",
        cacheDir,
      });

      expect(api.source).toBe("static+runtime");
      expect(api.runtimeShape?.entrypoints[0]?.exports.length).toBeGreaterThan(0);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
