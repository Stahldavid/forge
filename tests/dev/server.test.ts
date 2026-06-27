import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("dev server", () => {
  test("serves health, entries, and invoke routes", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        const home = await fetch(`${handle.url}/`, {
          headers: { Accept: "text/html" },
        });
        expect(home.status).toBe(200);
        expect(await home.text()).toContain("Forge Dev");

        const health = await fetch(`${handle.url}/health`);
        expect(health.status).toBe(200);
        const healthBody = (await health.json()) as {
          ok: boolean;
          service: string;
          entries: number;
        };
        expect(healthBody.ok).toBe(true);
        expect(healthBody.service).toBe("forge-dev");
        expect(healthBody.entries).toBeGreaterThan(0);

        const entries = await fetch(`${handle.url}/entries`);
        expect(entries.status).toBe(200);
        const entriesBody = (await entries.json()) as {
          ok: boolean;
          entries: { name: string }[];
        };
        expect(entriesBody.ok).toBe(true);
        expect(entriesBody.entries.some((entry) => entry.name === "charge")).toBe(
          true,
        );

        const getCommand = await fetch(`${handle.url}/commands/charge`);
        expect(getCommand.status).toBe(405);
        const getCommandBody = (await getCommand.json()) as {
          example: { method: string; path: string };
        };
        expect(getCommandBody.example).toMatchObject({
          method: "POST",
          path: "/commands/charge",
        });

        const invoke = await fetch(`${handle.url}/run/charge`, {
          method: "POST",
        });
        expect(invoke.status).toBe(200);
        const invokeBody = (await invoke.json()) as {
          ok: boolean;
          result: { ok: boolean };
        };
        expect(invokeBody.ok).toBe(true);
        expect(invokeBody.result).toEqual({ ok: true });
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("serves generated WorkOS webhook endpoint with signature and replay checks", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-workos-webhook");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"),
        'export const workosWebhookHttpRoute = { method: "POST", path: "/webhooks/workos" } as const;\n',
        "utf8",
      );
      writeFileSync(join(workspace, ".env.local"), "WORKOS_WEBHOOK_SECRET=whsec_test\n", "utf8");

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        expect(handle.routes.some((route) => route.method === "POST" && route.path === "/webhooks/workos")).toBe(true);

        const home = await fetch(`${handle.url}/`);
        expect(home.status).toBe(200);
        const homeBody = (await home.json()) as {
          routes: Array<{ method: string; path: string; purpose: string }>;
        };
        expect(homeBody.routes).toContainEqual({
          method: "POST",
          path: "/webhooks/workos",
          purpose: "webhook",
        });

        const payload = JSON.stringify({
          id: "evt_workos_1",
          event: "organization_membership.created",
        });
        const timestamp = String(Date.now());
        const signature = createHmac("sha256", "whsec_test")
          .update(`${timestamp}.${payload}`)
          .digest("hex");

        const accepted = await fetch(`${handle.url}/webhooks/workos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "WorkOS-Signature": `t=${timestamp},v1=${signature}`,
          },
          body: payload,
        });
        expect(accepted.status).toBe(200);
        await expect(accepted.json()).resolves.toMatchObject({
          ok: true,
          provider: "workos",
          eventId: "evt_workos_1",
          event: "organization_membership.created",
        });

        const replay = await fetch(`${handle.url}/webhooks/workos`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "WorkOS-Signature": `t=${timestamp},v1=${signature}`,
          },
          body: payload,
        });
        expect(replay.status).toBe(401);
        const replayBody = (await replay.json()) as {
          diagnostics: Array<{ code: string }>;
        };
        expect(replayBody.diagnostics[0]?.code).toBe("FORGE_WEBHOOK_REPLAY_DETECTED");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("serves generated WorkOS AuthKit routes with session claims", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-workos-authkit", {
      packageFixtures: ["forge", "zod", "@workos-inc/node"],
    });
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"),
        'export const workosAuthHttpRoutes = [{ method: "GET", path: "/login" }] as const;\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, ".env.local"),
        [
          "WORKOS_API_KEY=sk_test",
          "WORKOS_CLIENT_ID=client_test",
          "WORKOS_COOKIE_PASSWORD=session_secret",
          "WORKOS_REDIRECT_URI=http://127.0.0.1:5173/callback",
          "WORKOS_POST_LOGIN_REDIRECT_URI=/dashboard",
          "WORKOS_POST_LOGOUT_REDIRECT_URI=/signed-out",
          "",
        ].join("\n"),
        "utf8",
      );

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        expect(handle.routes).toContainEqual({ method: "GET", path: "/login", purpose: "auth" });
        expect(handle.routes).toContainEqual({ method: "GET", path: "/callback", purpose: "auth" });
        expect(handle.routes).toContainEqual({ method: "POST", path: "/logout", purpose: "auth" });
        expect(handle.routes).toContainEqual({ method: "GET", path: "/session", purpose: "auth" });

        const login = await fetch(`${handle.url}/login?returnTo=/app`, { redirect: "manual" });
        expect(login.status).toBe(302);
        expect(login.headers.get("location")).toContain("provider=authkit");
        expect(login.headers.get("location")).toContain("client_test");

        const callback = await fetch(`${handle.url}/callback?code=code_test&state=/app`, { redirect: "manual" });
        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe("/app");
        const cookie = callback.headers.get("set-cookie") ?? "";
        expect(cookie).toContain("forgeos_workos_session=");

        const session = await fetch(`${handle.url}/session`, {
          headers: { cookie },
        });
        expect(session.status).toBe(200);
        const sessionBody = (await session.json()) as {
          ok: boolean;
          session: { claims: { organization_id?: string; permissions?: string[] } };
        };
        expect(sessionBody.ok).toBe(true);
        expect(sessionBody.session.claims.organization_id).toBe("org_acme");
        expect(sessionBody.session.claims.permissions).toContain("invitations:create");

        const logout = await fetch(`${handle.url}/logout`, { method: "POST", redirect: "manual" });
        expect(logout.status).toBe(302);
        expect(logout.headers.get("location")).toBe("/signed-out");
        expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("serves public auth.md for agent-readable authorization metadata", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-auth-md");
    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      mkdirSync(join(workspace, "public"), { recursive: true });
      writeFileSync(
        join(workspace, "public/auth.md"),
        "# auth.md\n\n- Tenant required: `true`\n",
        "utf8",
      );
      mkdirSync(join(workspace, "public", ".well-known"), { recursive: true });
      writeFileSync(
        join(workspace, "public", ".well-known", "oauth-protected-resource"),
        JSON.stringify({ resource: "/", resource_documentation: "/auth.md" }),
        "utf8",
      );

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        expect(handle.routes).toContainEqual({
          method: "GET",
          path: "/auth.md",
          purpose: "auth-md",
        });
        expect(handle.routes).toContainEqual({
          method: "GET",
          path: "/.well-known/oauth-protected-resource",
          purpose: "auth-metadata",
        });
        const response = await fetch(`${handle.url}/auth.md`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/markdown");
        expect(await response.text()).toContain("Tenant required");
        const authHead = await fetch(`${handle.url}/auth.md`, { method: "HEAD" });
        expect(authHead.status).toBe(200);
        expect(authHead.headers.get("content-type")).toContain("text/markdown");
        expect(await authHead.text()).toBe("");
        const metadata = await fetch(`${handle.url}/.well-known/oauth-protected-resource`);
        expect(metadata.status).toBe(200);
        const metadataBody = await metadata.json() as { resource_documentation: string; scopes_supported?: string[] };
        expect(metadataBody).toMatchObject({ resource_documentation: "/auth.md" });
        const metadataHead = await fetch(`${handle.url}/.well-known/oauth-protected-resource`, { method: "HEAD" });
        expect(metadataHead.status).toBe(200);
        expect(metadataHead.headers.get("content-type")).toContain("application/json");
        expect(await metadataHead.text()).toBe("");
        const agentAuthDoc = await fetch(`${handle.url}${metadataBody.resource_documentation}`);
        expect(agentAuthDoc.status).toBe(200);
        expect(await agentAuthDoc.text()).toContain("auth.md");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("surfaces runtime import failures in request diagnostics", async () => {
    const workspace = scaffoldGenerateWorkspace("dev-server-runtime-error");
    try {
      writeFileSync(
        join(workspace, "src", "forge", "bad-import.ts"),
        [
          'import { command } from "forge/server";',
          "",
          'throw "visible import failure";',
          "",
          "export const badImport = command(async () => ({ ok: true }));",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "none",
      });

      try {
        const invoke = await fetch(`${handle.url}/commands/badImport`, {
          method: "POST",
        });
        expect(invoke.status).toBe(500);
        const body = (await invoke.json()) as {
          diagnostics: Array<{ message: string }>;
        };
        expect(body.diagnostics[0]?.message).toContain("visible import failure");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
