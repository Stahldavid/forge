import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { digestCanonical, sha256Digest } from "./canonical.ts";
import type { EvolutionOwnerVerifier, OwnerDecisionChallenge } from "./local-evolution-registry.ts";

function html(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function launchBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Cooperative human review on loopback; same-account UI/shell control is outside this boundary. */
export function localEvolutionOwnerVerifier(options: {
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
} = {}): EvolutionOwnerVerifier {
  return { async verify(challenge: Readonly<OwnerDecisionChallenge>) {
    const token = randomBytes(32).toString("hex");
    const digest = digestCanonical(challenge, sha256Digest);
    const timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("Invalid owner review timeout");
    let origin = "";
    let decided = false;
    let settle!: (approved: boolean) => void;
    let fail!: (error: Error) => void;
    const outcome = new Promise<boolean>((resolve, reject) => { settle = resolve; fail = reject; });
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      if (request.headers.host !== origin.slice(7)) { response.writeHead(400).end(); return; }
      if (request.method === "GET" && request.url === `/${token}` && !decided) {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.writeHead(200).end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Forge evolution review</title><style>body{font:16px system-ui;background:#f4f6f8;color:#14202b;padding:24px}main{max-width:720px;margin:auto;background:white;padding:24px;border-radius:12px}dt{font-weight:bold;margin-top:14px}dd{margin:4px 0;overflow-wrap:anywhere}button{padding:12px;margin:12px 8px 0 0;cursor:pointer}</style><main><h1>Review extension decision</h1><p>This local decision changes the selected extension version. Inspect the fixed evaluation and version status before approving.</p><dl><dt>Action</dt><dd>${html(challenge.action)}</dd><dt>Extension</dt><dd>${html(challenge.extensionKey)}</dd><dt>Version</dt><dd>${html(challenge.versionId)}</dd><dt>Expected current selection</dt><dd>${html(challenge.expectedSelection ?? "none")}</dd><dt>Evaluation evidence</dt><dd>${html(challenge.evaluationDigest ?? "none")}</dd><dt>Decision digest</dt><dd>${html(digest)}</dd></dl><form method="post" action="/decision/${token}"><input type="hidden" name="digest" value="${html(digest)}"><button name="decision" value="approved">Approve ${html(challenge.action)}</button><button name="decision" value="rejected">Reject</button></form></main></html>`);
        return;
      }
      const sameOrigin = request.headers.origin === origin ||
        (request.headers.origin === "null" && request.headers["sec-fetch-site"] === "same-origin");
      if (request.method !== "POST" || request.url !== `/decision/${token}` || decided || !sameOrigin ||
          request.headers["content-type"] !== "application/x-www-form-urlencoded") {
        response.writeHead(403).end(); return;
      }
      let body = "";
      request.on("data", (part: Buffer) => { body += part.toString("utf8"); if (body.length > 2048) request.destroy(); });
      request.on("end", () => {
        const values = new URLSearchParams(body);
        const decision = values.get("decision");
        if (values.size !== 2 || values.get("digest") !== digest ||
            (decision !== "approved" && decision !== "rejected")) { response.writeHead(400).end(); return; }
        decided = true;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.writeHead(200).end(`<meta charset="utf-8"><p>${decision === "approved" ? "Approved" : "Rejected"}. You may close this window.</p>`);
        response.once("finish", () => settle(decision === "approved"));
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const timer = setTimeout(() => fail(new Error("Owner review timed out")), timeoutMs);
    try {
      await (options.openBrowser ?? launchBrowser)(`${origin}/${token}`);
      if (!await outcome) throw new Error("Owner rejected evolution decision");
      return { verifierId: "local-owner-window", challengeDigest: digest,
        evidenceDigest: sha256Digest(`owner-approved:${digest}:${token}`) };
    } finally {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } };
}
