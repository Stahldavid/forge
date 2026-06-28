import { afterEach, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { evaluateCommandAuth } from "../../src/forge/runtime/auth/evaluate.ts";
import { mapClaimsToAuthContext } from "../../src/forge/runtime/auth/claims.ts";
import { loadAuthConfigFromEnv } from "../../src/forge/runtime/auth/config.ts";
import { verifyJwtToken } from "../../src/forge/runtime/auth/verifier.ts";
import { formatAuthHuman, runAuthCommand } from "../../src/forge/cli/auth.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runServeCommand } from "../../src/forge/cli/serve.ts";
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
} = {}) {
  let issuer = options.issuer ?? "";
  const audience = options.audience ?? "api://forge-test";
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const kid = "forge-test-key";
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
      return Response.json({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] });
    },
  });
  port = server.port ?? 0;
  issuer = issuer || `http://127.0.0.1:${server.port}`;

  const token = await new SignJWT({
    tenant_id: "tenant-a",
    roles: ["member"],
    permissions: ["tickets:read"],
    email: "user@example.com",
    ...options.claims,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("user-1")
    .setIssuedAt(1_700_000_000)
    .setExpirationTime(options.exp ?? 4_100_000_000)
    .sign(privateKey);

  return {
    token,
    issuer,
    audience,
    jwksUri: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    oidcIssuer: `http://127.0.0.1:${port}`,
    stop: () => server.stop(true),
  };
}

describe("H20 auth resource server", () => {
  test("maps literal and dot-path claims to ctx.auth", () => {
    const auth = mapClaimsToAuthContext(
      {
        sub: "auth0|123",
        "https://example.com/tenant_id": "tenant-1",
        realm_access: { roles: ["admin", "member"] },
        permissions: "tickets:create,tickets:read",
      },
      {
        mode: "jwt",
        issuer: "issuer",
        audience: "audience",
        jwksUri: "http://jwks",
        algorithms: ["RS256"],
        requiresTenant: true,
        claims: {
          userId: "sub",
          tenantId: "https://example.com/tenant_id",
          roles: "realm_access.roles",
          permissions: "permissions",
        },
      },
      {
        issuer: "issuer",
        audience: "audience",
        subject: "auth0|123",
        authProvider: "jwt",
      },
    );

    expect(auth.kind).toBe("user");
    if (auth.kind === "user") {
      expect(auth.userId).toBe("auth0|123");
      expect(auth.tenantId).toBe("tenant-1");
      expect(auth.roles).toEqual(["admin", "member"]);
      expect(auth.permissions).toEqual(["tickets:create", "tickets:read"]);
    }
  });

  test("missing tenant claim is denied for tenant-scoped runtime", () => {
    expect(() =>
      mapClaimsToAuthContext(
        { sub: "user-1" },
        {
          mode: "jwt",
          algorithms: ["RS256"],
          claims: { userId: "sub", tenantId: "tenant_id" },
          requiresTenant: true,
        },
        { authProvider: "jwt" },
      ),
    ).toThrow("tenant claim");
  });

  test("roles array satisfies canRole policy evaluation", () => {
    const result = evaluateCommandAuth(
      { kind: "user", userId: "u1", tenantId: "t1", roles: ["member"] },
      {
        commandName: "createTicket",
        file: "src/forge/commands.ts",
        symbolId: "createTicket",
        auth: { kind: "policy", policy: "tickets.create" },
      },
      {
        schemaVersion: "0.1.0",
        generatorVersion: "test",
        inputHash: "test",
        entries: [{ policy: "tickets.create", roles: ["owner", "member"], permissions: [] }],
      },
    );

    expect(result.allowed).toBe(true);
  });

  test("permissions array satisfies canPermission policy evaluation", () => {
    const result = evaluateCommandAuth(
      {
        kind: "user",
        userId: "u1",
        tenantId: "org_acme",
        permissions: ["invitations:create"],
      },
      {
        commandName: "inviteMember",
        file: "src/commands/inviteMember.ts",
        symbolId: "inviteMember",
        auth: { kind: "policy", policy: "invitations.create" },
      },
      {
        schemaVersion: "0.1.0",
        generatorVersion: "test",
        inputHash: "test",
        entries: [{ policy: "invitations.create", roles: [], permissions: ["invitations:create"] }],
      },
    );

    expect(result.allowed).toBe(true);
  });

  test("valid JWT verifies and maps through forge auth test-token", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-auth-cli");
    const fixture = await createJwtFixture();
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "jwt";
      process.env.FORGE_AUTH_ISSUER = fixture.issuer;
      process.env.FORGE_AUTH_AUDIENCE = fixture.audience;
      process.env.FORGE_AUTH_JWKS_URI = fixture.jwksUri;

      const result = await runAuthCommand({
        subcommand: "test-token",
        workspaceRoot: workspace,
        json: true,
        token: fixture.token,
      });

      expect(result.ok).toBe(true);
      expect((result.data as { auth: { userId: string; tenantId: string } }).auth.userId).toBe(
        "user-1",
      );
    } finally {
      fixture.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("JWT verifier rejects wrong issuer, wrong audience, and expired token", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-auth-invalid");
    const fixture = await createJwtFixture({ exp: 1 });
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "jwt";
      process.env.FORGE_AUTH_ISSUER = `${fixture.issuer}wrong`;
      process.env.FORGE_AUTH_AUDIENCE = `${fixture.audience}-wrong`;
      process.env.FORGE_AUTH_JWKS_URI = fixture.jwksUri;
      const config = loadAuthConfigFromEnv(workspace);

      await expect(verifyJwtToken(fixture.token, config)).rejects.toThrow();
    } finally {
      fixture.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("OIDC mode discovers jwks_uri from issuer metadata", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-auth-oidc");
    const fixture = await createJwtFixture();
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "oidc";
      process.env.FORGE_AUTH_ISSUER = fixture.oidcIssuer;
      process.env.FORGE_AUTH_AUDIENCE = fixture.audience;
      const verified = await verifyJwtToken(fixture.token, loadAuthConfigFromEnv(workspace));
      expect(verified.payload.sub).toBe("user-1");
    } finally {
      fixture.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("generated client sends Authorization Bearer from getToken", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-client-token");
    const originalFetch = globalThis.fetch;
    let authorization = "";

    globalThis.fetch = (async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ ok: true, result: [] });
    }) as typeof fetch;

    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const { createForgeClient } = await import(
        `${workspace}/src/forge/_generated/client.ts`
      );
      const client = createForgeClient({
        url: "http://127.0.0.1:3765",
        auth: { getToken: async () => "jwt-token" },
      });
      await client.query("listTickets", {});
      expect(authorization).toBe("Bearer jwt-token");
    } finally {
      globalThis.fetch = originalFetch;
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("parseCli accepts auth and serve --allow-dev-auth", () => {
    const auth = parseCli(["auth", "test-token", "--token", "abc", "--json"]);
    expect(auth.errors).toEqual([]);
    expect(auth.command?.kind).toBe("auth");

    const status = parseCli(["auth", "status", "--json"]);
    expect(status.errors).toEqual([]);
    expect(status.command?.kind).toBe("auth");

    const proveProd = parseCli(["auth", "prove", "--prod", "--token", "abc", "--json"]);
    expect(proveProd.errors).toEqual([]);
    expect(proveProd.command?.kind).toBe("auth");
    if (proveProd.command?.kind === "auth") {
      expect(proveProd.command.prod).toBe(true);
    }

    const serve = parseCli(["serve", "--allow-dev-auth"]);
    expect(serve.errors).toEqual([]);
    expect(serve.command?.kind).toBe("serve");
  });

  test("auth status makes dev headers local-only", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-auth-status");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "dev-headers";
      const result = await runAuthCommand({
        subcommand: "status",
        workspaceRoot: workspace,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        mode: "dev-headers",
        classification: "local-dev",
        localOnly: true,
        productionReady: false,
        localDevHeaders: {
          acceptedHeaders: expect.arrayContaining(["x-forge-user-id", "x-forge-permissions"]),
          neverProduction: true,
        },
        productionRequirements: {
          requiredMode: "jwt or oidc",
          proofCommand: "forge auth prove --prod --token <jwt> --json",
        },
      });
      const human = formatAuthHuman(result);
      expect(human).toContain("Auth dev-headers: ok (local-dev)");
      expect(human).toContain("Production ready: no");
      expect(human).toContain("x-forge-permissions");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("auth prove --prod requires production mode and token", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-auth-prod-proof");
    const fixture = await createJwtFixture();
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "dev-headers";
      const local = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        prod: true,
        token: fixture.token,
      });
      expect(local.ok).toBe(false);
      expect(local.error?.code).toBe("FORGE_AUTH_MODE_INVALID");

      process.env.FORGE_AUTH_MODE = "jwt";
      process.env.FORGE_AUTH_ISSUER = fixture.issuer;
      process.env.FORGE_AUTH_AUDIENCE = fixture.audience;
      process.env.FORGE_AUTH_JWKS_URI = fixture.jwksUri;

      const missingToken = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        prod: true,
      });
      expect(missingToken.ok).toBe(false);
      expect(missingToken.error?.code).toBe("FORGE_AUTH_MISSING_TOKEN");

      const proof = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        prod: true,
        token: fixture.token,
      });
      expect(proof.ok).toBe(true);
      expect(proof.data).toMatchObject({
        prod: true,
        productionReady: true,
      });
    } finally {
      fixture.stop();
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("forge serve rejects dev-headers before requiring database", async () => {
    const workspace = scaffoldGenerateWorkspace("h20-serve-dev-headers");
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      process.env.FORGE_AUTH_MODE = "dev-headers";
      const result = await runServeCommand({
        workspaceRoot: workspace,
        json: true,
        allowDevAuth: false,
      });
      expect(result).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
