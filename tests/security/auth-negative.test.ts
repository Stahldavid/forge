import { afterEach, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  FORGE_AUTH_CLAIM_INVALID,
  FORGE_AUTH_INVALID_AUDIENCE,
  FORGE_AUTH_INVALID_ISSUER,
  FORGE_AUTH_INVALID_TOKEN,
  FORGE_AUTH_MISSING_TOKEN,
  FORGE_AUTH_TENANT_MISSING,
  FORGE_AUTH_TOKEN_EXPIRED,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { authenticateHeaders } from "../../src/forge/runtime/auth/authenticate.ts";
import { mapClaimsToAuthContext } from "../../src/forge/runtime/auth/claims.ts";
import { loadAuthConfigFromEnv } from "../../src/forge/runtime/auth/config.ts";
import { ForgeAuthError, type ForgeAuthDiagnosticCode } from "../../src/forge/runtime/auth/errors.ts";
import { verifyJwtToken } from "../../src/forge/runtime/auth/verifier.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function createJwtFixture(options: {
  issuer?: string;
  audience?: string;
  claims?: Record<string, unknown>;
  exp?: number;
  tokenKid?: string;
} = {}) {
  let issuer = options.issuer ?? "";
  const audience = options.audience ?? "api://forge-security-test";
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwksKid = "forge-security-key";
  let port = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer,
          jwks_uri: `http://127.0.0.1:${port}/.well-known/jwks.json`,
        });
      }
      return Response.json({ keys: [{ ...jwk, kid: jwksKid, alg: "RS256", use: "sig" }] });
    },
  });
  port = server.port ?? 0;
  issuer = issuer || `http://127.0.0.1:${server.port}`;

  const token = await new SignJWT({
    tenant_id: "tenant-a",
    roles: ["member"],
    permissions: ["tickets:read"],
    ...options.claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: options.tokenKid ?? jwksKid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt(1_700_000_000)
    .setExpirationTime(options.exp ?? 4_100_000_000)
    .sign(privateKey);

  const wrongAlgToken = await new SignJWT({
    tenant_id: "tenant-a",
    roles: ["member"],
  })
    .setProtectedHeader({ alg: "HS256", kid: jwksKid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt(1_700_000_000)
    .setExpirationTime(4_100_000_000)
    .sign(new TextEncoder().encode("forge-test-secret"));

  return {
    token,
    wrongAlgToken,
    issuer,
    audience,
    jwksUri: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    stop: () => server.stop(true),
  };
}

function configureJwt(workspace: string, fixture: { issuer: string; audience: string; jwksUri: string }) {
  process.env.FORGE_AUTH_MODE = "jwt";
  process.env.FORGE_AUTH_ISSUER = fixture.issuer;
  process.env.FORGE_AUTH_AUDIENCE = fixture.audience;
  process.env.FORGE_AUTH_JWKS_URI = fixture.jwksUri;
  return loadAuthConfigFromEnv(workspace, { requiresTenant: true });
}

async function expectAuthError(promise: Promise<unknown>, code: ForgeAuthDiagnosticCode) {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ForgeAuthError);
    expect((error as ForgeAuthError).code).toBe(code);
  }
}

function expectSyncAuthError(fn: () => unknown, code: ForgeAuthDiagnosticCode) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ForgeAuthError);
    expect((error as ForgeAuthError).code).toBe(code);
  }
}

describe("security assurance: JWT/OIDC negative auth", () => {
  test("rejects expired token, wrong issuer, wrong audience, wrong algorithm, and unknown kid", async () => {
    const workspace = scaffoldGenerateWorkspace("security-auth-negative-token");
    const valid = await createJwtFixture();
    const expired = await createJwtFixture({ exp: 1 });
    const unknownKid = await createJwtFixture({ tokenKid: "unknown-kid" });
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));

      let config = configureJwt(workspace, expired);
      await expectAuthError(verifyJwtToken(expired.token, config), FORGE_AUTH_TOKEN_EXPIRED);

      config = configureJwt(workspace, valid);
      process.env.FORGE_AUTH_ISSUER = `${valid.issuer}/wrong`;
      await expectAuthError(verifyJwtToken(valid.token, loadAuthConfigFromEnv(workspace)), FORGE_AUTH_INVALID_ISSUER);

      config = configureJwt(workspace, valid);
      process.env.FORGE_AUTH_AUDIENCE = `${valid.audience}-wrong`;
      await expectAuthError(verifyJwtToken(valid.token, loadAuthConfigFromEnv(workspace)), FORGE_AUTH_INVALID_AUDIENCE);

      config = configureJwt(workspace, valid);
      await expectAuthError(verifyJwtToken(valid.wrongAlgToken, config), FORGE_AUTH_INVALID_TOKEN);

      config = configureJwt(workspace, unknownKid);
      await expectAuthError(verifyJwtToken(unknownKid.token, config), FORGE_AUTH_INVALID_TOKEN);
    } finally {
      valid.stop();
      expired.stop();
      unknownKid.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("rejects missing tenant claim and invalid role claim", async () => {
    const workspace = scaffoldGenerateWorkspace("security-auth-negative-claims");
    const missingTenant = await createJwtFixture({ claims: { tenant_id: undefined } });
    const invalidRole = await createJwtFixture({ claims: { roles: [{ name: "member" }] } });
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      let config = configureJwt(workspace, missingTenant);
      let verified = await verifyJwtToken(missingTenant.token, config);
      expectSyncAuthError(
        () => mapClaimsToAuthContext(verified.payload, config, verified.token),
        FORGE_AUTH_TENANT_MISSING,
      );

      config = configureJwt(workspace, invalidRole);
      verified = await verifyJwtToken(invalidRole.token, config);
      expectSyncAuthError(
        () => mapClaimsToAuthContext(verified.payload, config, verified.token),
        FORGE_AUTH_CLAIM_INVALID,
      );
    } finally {
      missingTenant.stop();
      invalidRole.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("ignores dev headers in jwt mode", async () => {
    const workspace = scaffoldGenerateWorkspace("security-auth-dev-headers-ignored");
    const fixture = await createJwtFixture();
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const config = configureJwt(workspace, fixture);

      await expectAuthError(
        authenticateHeaders(
          new Headers({
            "x-forge-user-id": "attacker",
            "x-forge-tenant-id": "tenant-b",
            "x-forge-role": "owner",
          }),
          config,
        ),
        FORGE_AUTH_MISSING_TOKEN,
      );

      const auth = await authenticateHeaders(
        new Headers({
          authorization: `Bearer ${fixture.token}`,
          "x-forge-user-id": "attacker",
          "x-forge-tenant-id": "tenant-b",
          "x-forge-role": "owner",
        }),
        config,
      );
      expect(auth.kind).toBe("user");
      if (auth.kind === "user") {
        expect(auth.userId).toBe("user-1");
        expect(auth.tenantId).toBe("tenant-a");
        expect(auth.role).not.toBe("owner");
      }
    } finally {
      fixture.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
