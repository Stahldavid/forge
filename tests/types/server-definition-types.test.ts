import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Forge server definition types", () => {
  test("infers handler args from explicit generics and zod-like input schemas", () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-server-types-"));
    try {
      writeFileSync(
        join(workspace, "server-types.ts"),
        `
import { action, command, liveQuery, query } from "forge/server";

const objectInput = <T>() => ({
  parse(input: unknown): T {
    return input as T;
  },
});

const createVendor = command({
  input: objectInput<{ vendorId: string; risk: "low" | "high" }>(),
  handler: async (_ctx, args) => {
    const vendorId: string = args.vendorId;
    const risk: "low" | "high" = args.risk;
    // @ts-expect-error schema inferred args should not allow unknown fields
    args.missing;
    return { vendorId, risk };
  },
});

const createExplicit = command<{ name: string }, { ok: boolean }>({
  handler: (_ctx, args) => {
    const name: string = args.name;
    // @ts-expect-error explicit generic args should not allow unknown fields
    args.missing;
    return { ok: name.length > 0 };
  },
});

const listVendors = query({
  inputSchema: objectInput<{ limit: number }>(),
  handler: (_ctx, args) => args?.limit ?? 0,
});

const liveVendors = liveQuery({
  input: objectInput<{ category: string }>(),
  handler: (_ctx, args) => args?.category.toUpperCase() ?? "",
});

const handleVendorEvent = action({
  inputSchema: objectInput<{ eventId: string }>(),
  handler: (_ctx, event) => event.eventId,
});

void createVendor;
void createExplicit;
void listVendors;
void liveVendors;
void handleVendorEvent;
`,
        "utf8",
      );
      writeFileSync(
        join(workspace, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              noEmit: true,
              allowImportingTsExtensions: true,
              types: ["node"],
              typeRoots: [join(process.cwd(), "node_modules", "@types")],
              baseUrl: process.cwd(),
              paths: {
                "forge/server": ["src/forge/server.ts"],
              },
            },
            include: ["server-types.ts"],
          },
          null,
          2,
        ),
        "utf8",
      );

      const tsc = Bun.spawnSync({
        cmd: [
          process.execPath,
          join(process.cwd(), "node_modules", "typescript", "bin", "tsc"),
          "-p",
          "tsconfig.json",
        ],
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(tsc.exitCode, `${tsc.stdout.toString()}\n${tsc.stderr.toString()}`).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
