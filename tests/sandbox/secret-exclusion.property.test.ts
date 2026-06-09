import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { canonicalJson } from "../../src/forge/compiler/primitives/serialize.ts";
import {
  assertPackageApiSecretSafe,
  scrubEnv,
  secretLeakScan,
  serializeRuntimeExportShape,
} from "../../src/forge/compiler/sandbox/index.ts";
import { makePackageApi } from "../helpers/package-api.ts";

const secretValueArb = fc
  .string({ minLength: 8, maxLength: 48 })
  .filter((s) => !/\s/.test(s));

const secretNameArb = fc.constantFrom(
  "STRIPE_SECRET_KEY",
  "OPENAI_API_KEY",
  "DATABASE_PASSWORD",
  "AUTH_TOKEN",
);

describe("Property 10: Secret Exclusion", () => {
  test("scrubEnv never passes secret-named keys or dotenv values", () => {
    fc.assert(
      fc.property(
        secretNameArb,
        secretValueArb,
        (secretName, secretValue) => {
          const scrubbed = scrubEnv(
            {
              PATH: "/bin",
              [secretName]: secretValue,
              HOME: "/home/user",
            },
            { dotEnvValues: [secretValue] },
          );

          expect(scrubbed[secretName]).toBeUndefined();
          expect(Object.values(scrubbed)).not.toContain(secretValue);
        },
      ),
      { numRuns: 40 },
    );
  });

  test("secret leak scan detects injected secrets in serialized inspection output", () => {
    fc.assert(
      fc.property(secretValueArb, (secretValue) => {
        const serialized = serializeRuntimeExportShape({
          entrypoints: [
            {
              subpath: ".",
              exports: [{ name: "safeExport", kind: "function" }],
            },
          ],
        });

        const clean = secretLeakScan(serialized, {
          knownSecretValues: [secretValue],
        });
        expect(clean.hasLeak).toBe(false);

        const leaked = secretLeakScan(`${serialized} ${secretValue}`, {
          knownSecretValues: [secretValue],
        });
        expect(leaked.hasLeak).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  test("package api artifacts exclude secret values while retaining safe metadata", () => {
    fc.assert(
      fc.property(secretNameArb, secretValueArb, (secretName, secretValue) => {
        const api = makePackageApi({
          name: "safe-pkg",
          entrypoints: [
            {
              subpath: ".",
              conditions: ["import"],
              patternBacked: false,
              dtsPath: "index.d.ts",
              exports: [
                {
                  name: "configure",
                  kind: "function",
                  signature: `function configure(env: ${secretName}): void`,
                  classification: {
                    alias: "safe-pkg",
                    packageName: "safe-pkg",
                    entrypoint: ".",
                    exportName: "configure",
                    compatible: ["server"],
                    incompatible: ["command"],
                    capabilities: {
                      network: {
                        status: "not-detected",
                        confidence: "static",
                        evidence: [],
                      },
                      filesystem: {
                        status: "not-detected",
                        confidence: "static",
                        evidence: [],
                      },
                      process: {
                        status: "not-detected",
                        confidence: "static",
                        evidence: [],
                      },
                      nativeAddon: {
                        status: "not-detected",
                        confidence: "static",
                        evidence: [],
                      },
                      lifecycleScripts: {
                        status: "not-detected",
                        confidence: "rule",
                        evidence: [],
                      },
                      secrets: [
                        {
                          envVar: secretName,
                          required: true,
                          detectedFrom: "recipe",
                        },
                      ],
                    },
                  },
                  jsdoc: null,
                  examples: [],
                },
              ],
            },
          ],
        });

        const serialized = canonicalJson(api);
        expect(serialized).toContain(secretName);
        expect(serialized).not.toContain(secretValue);
        expect(
          secretLeakScan(serialized, { knownSecretValues: [secretValue] }).hasLeak,
        ).toBe(false);
        expect(() => assertPackageApiSecretSafe(api, [secretValue])).not.toThrow();
      }),
      { numRuns: 30 },
    );
  });

  test("token prefixes are always flagged in serialized inspection output", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("sk_test_", "pk_live_", "ghp_", "xoxb-"),
        (prefix) => {
          const payload = `{"entrypoints":[{"subpath":".","exports":[{"name":"x","kind":"const"}]}]} ${prefix}abc`;
          expect(secretLeakScan(payload).hasLeak).toBe(true);
        },
      ),
      { numRuns: 8 },
    );
  });
});
