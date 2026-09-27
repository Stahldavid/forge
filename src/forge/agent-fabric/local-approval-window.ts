import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { LocalCodingTaskProposal } from "./local-task-contract.ts";
import type { LocalMemoryEntry } from "./local-intelligence.ts";
import type { Digest } from "./types.ts";

export interface LocalApprovalView {
  taskId: string;
  repositoryRoot: string;
  proposal: Readonly<LocalCodingTaskProposal>;
  proposalDigest: Digest;
  memory?: readonly LocalMemoryEntry[];
}

export interface LocalPatchReviewView {
  taskId: string;
  repositoryRoot: string;
  baseCommit: string;
  diffDigest: Digest;
  diff: string;
  verification: "diff_check_passed" | "diff_check_failed";
  sandboxVerification?: { state: "started" | "finished"; outcome?: string; evidenceDigest?: Digest };
}

interface LocalVerificationRecoveryBase {
  kind: "verification-recovery";
  taskId: string;
  repositoryRoot: string;
  diffDigest: Digest;
  requestDigest: Digest;
}

export type LocalVerificationRecoveryView = LocalVerificationRecoveryBase & (
  | { mode: "clear" }
  | { mode: "continue"; remainingCommands: readonly { path: string; timeoutMs: number }[] }
);

export type LocalApprovalDecision = "approved" | "rejected";

interface ApprovalWindowOptions {
  openBrowser?: (url: string) => Promise<void>;
  timeoutMs?: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function row(label: string, value: string): string {
  return `<div class="row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderPage(view: LocalApprovalView, token: string): string {
  const task = view.proposal;
  const expires = new Date(task.limits.expiresAt).toISOString();
  const fields = [
    row("Repositório", view.repositoryRoot),
    row("Identidade", task.repositoryId),
    row("Commit base", task.baseCommit),
    row("Objetivo", task.goal),
    row("Aceite", task.acceptanceCriteria.join(" • ")),
    row("Fora do escopo", task.nonObjectives.join(" • ") || "Nenhum"),
    row("Leitura", task.sourcePaths.join(" • ")),
    row("Memória privada selecionada (dados sem autoridade)", view.memory?.map((entry) =>
      `${entry.id}: ${entry.text} (fonte ${entry.sourceSnapshotDigest}; expira ${new Date(entry.expiresAt).toISOString()})`).join(" • ") || "Nenhuma"),
    row("Escrita", task.writablePaths.join(" • ")),
    row("Alvo local", task.requestedModelTargetId),
    row("Modelo aprovado", task.requestedModelId ?? "Desconhecido (proposta antiga)"),
    row("Limites", `${task.limits.maximumAttempts} tentativa(s); ${task.limits.maximumWallClockMs} ms; ${task.limits.maximumOutputTokens} tokens; ${task.limits.maximumContextBytes} bytes de contexto; ${task.limits.maximumPatchBytes} bytes de patch`),
    row("Expira", expires),
    row("Comandos de verificação", task.verification
      ? `${task.verification.commands.map((command) => command.kind === "node-test-file" ? `node --test ${command.path} (${command.timeoutMs} ms)` : `git diff --check (${command.timeoutMs} ms)`).join(" • ")} | imagem ${task.verification.imageId}`
      : "Nenhum"),
    row("Revisão SHA-256", view.proposalDigest),
  ].join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge · Aprovar tarefa</title><style>
    :root{font-family:system-ui,sans-serif;color-scheme:light;background:#f4f6f8;color:#14202b}body{margin:0;padding:32px 16px}main{max-width:750px;margin:auto;background:white;border:1px solid #d8e0e7;border-radius:16px;padding:28px;box-shadow:0 10px 30px #20304016}h1{margin:0 0 8px;font-size:1.65rem}p{line-height:1.5;color:#42576a}.badge{display:inline-block;background:#e5f1ed;color:#13694c;border-radius:8px;padding:5px 9px;font-size:.8rem;font-weight:700}dl{margin:24px 0}.row{display:grid;grid-template-columns:165px 1fr;gap:12px;border-top:1px solid #e4e9ed;padding:12px 0}dt{font-weight:700;color:#42576a}dd{margin:0;overflow-wrap:anywhere}form{display:flex;gap:12px}button{cursor:pointer;border:0;border-radius:9px;padding:12px 20px;font-size:1rem;font-weight:700}button[value=approved]{background:#0a7050;color:white}button[value=rejected]{background:#dfe5e9;color:#14202b}@media(max-width:560px){.row{grid-template-columns:1fr;gap:4px}form{flex-direction:column}}
  </style></head><body><main><span class="badge">Forge Agent Fabric · piloto local</span><h1>Revisar tarefa</h1><p>Esta decisão autoriza a tentativa local e os comandos de verificação exibidos. Ela não publica nem faz merge.</p><p><strong>${escapeHtml(view.taskId)}</strong></p><dl>${fields}</dl><form method="post" action="/decision/${token}"><input type="hidden" name="digest" value="${escapeHtml(view.proposalDigest)}"><button type="submit" name="decision" value="approved">Aprovar revisão</button><button type="submit" name="decision" value="rejected">Rejeitar</button></form></main></body></html>`;
}

function renderPatchPage(view: LocalPatchReviewView, token: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge · Aceitar resultado</title><style>
    :root{font-family:system-ui,sans-serif;color-scheme:light;background:#f4f6f8;color:#14202b}body{margin:0;padding:24px}main{max-width:1000px;margin:auto;background:white;padding:24px;border-radius:12px}pre{white-space:pre;overflow:auto;max-height:60vh;padding:16px;background:#15202b;color:#eaf2f7;border-radius:8px}form{display:flex;gap:12px}button{padding:12px 18px;cursor:pointer}strong{overflow-wrap:anywhere}
  </style></head><body><main><h1>Revisar resultado</h1><p>Esta decisão registra seu aceite do diff. Ela não faz merge, publica ou altera o checkout original.</p><p>Repositório: <strong>${escapeHtml(view.repositoryRoot)}</strong></p><p>Commit base: <strong>${escapeHtml(view.baseCommit)}</strong></p><p>Tarefa: <strong>${escapeHtml(view.taskId)}</strong></p><p>Verificação Git: <strong>${escapeHtml(view.verification)}</strong></p><p>Verificação isolada: <strong>${escapeHtml(view.sandboxVerification ? `${view.sandboxVerification.state}: ${view.sandboxVerification.outcome ?? "incerta"}; ${view.sandboxVerification.evidenceDigest ?? "sem recibo"}` : "não solicitada")}</strong></p><p>Digest do diff: <strong>${escapeHtml(view.diffDigest)}</strong></p><pre>${escapeHtml(view.diff)}</pre><form method="post" action="/decision/${token}"><input type="hidden" name="digest" value="${escapeHtml(view.diffDigest)}"><button type="submit" name="decision" value="approved">Aceitar este diff</button><button type="submit" name="decision" value="rejected">Rejeitar</button></form></main></body></html>`;
}

function renderVerificationRecoveryPage(view: LocalVerificationRecoveryView, token: string): string {
  const continuation = view.mode === "continue";
  const explanation = continuation
    ? "Os comandos anteriores têm recibos duráveis. Aprovar executa somente os testes restantes do mesmo perfil aprovado, em contêineres isolados. Nenhum comando já iniciado será repetido; um início incerto continuará bloqueado."
    : "O registro durável confirma que nenhum contêiner foi iniciado nesta tentativa. Aprovar remove somente esta intenção de verificação e permite iniciar uma nova tentativa com o mesmo perfil aprovado.";
  const remaining = continuation
    ? `<h2>Testes restantes</h2><ul>${view.remainingCommands.map((command) =>
      `<li>${escapeHtml(command.path)} (${command.timeoutMs} ms)</li>`).join("")}</ul>` : "";
  const approveLabel = continuation ? "Executar testes restantes" : "Permitir nova verificação";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge · Recuperar verificação</title></head><body><main><h1>Recuperar verificação</h1><p>${explanation}</p><p>Repositório: <strong>${escapeHtml(view.repositoryRoot)}</strong></p><p>Tarefa: <strong>${escapeHtml(view.taskId)}</strong></p><p>Diff: <strong>${escapeHtml(view.diffDigest)}</strong></p><p>Solicitação: <strong>${escapeHtml(view.requestDigest)}</strong></p>${remaining}<form method="post" action="/decision/${token}"><input type="hidden" name="digest" value="${escapeHtml(view.requestDigest)}"><button type="submit" name="decision" value="approved">${approveLabel}</button><button type="submit" name="decision" value="rejected">Manter bloqueada</button></form></main></body></html>`;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Human-facing cooperative approval. It is not protection from same-account shell/UI control. */
export async function requestLocalApproval(
  view: LocalApprovalView,
  options: ApprovalWindowOptions = {},
): Promise<LocalApprovalDecision> {
  return requestLocalDecision(view, options);
}

export async function requestLocalPatchAcceptance(
  view: LocalPatchReviewView,
  options: ApprovalWindowOptions = {},
): Promise<LocalApprovalDecision> {
  return requestLocalDecision(view, options);
}

export async function requestLocalVerificationRecovery(
  view: LocalVerificationRecoveryView,
  options: ApprovalWindowOptions = {},
): Promise<LocalApprovalDecision> {
  return requestLocalDecision(view, options);
}

async function requestLocalDecision(
  view: LocalApprovalView | LocalPatchReviewView | LocalVerificationRecoveryView,
  options: ApprovalWindowOptions,
): Promise<LocalApprovalDecision> {
  const boundDigest = "kind" in view ? view.requestDigest :
    "proposal" in view ? view.proposalDigest : view.diffDigest;
  const token = randomBytes(32).toString("hex");
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error("Invalid local approval timeout");
  }
  let settle!: (decision: LocalApprovalDecision) => void;
  let fail!: (reason: Error) => void;
  const outcome = new Promise<LocalApprovalDecision>((resolve, reject) => { settle = resolve; fail = reject; });
  let decided = false;
  let origin = "";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (request.headers.host !== origin.slice("http://".length)) {
      response.writeHead(400).end();
      return;
    }
    if (request.method === "GET" && request.url === `/${token}` && !decided) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.writeHead(200).end("kind" in view ? renderVerificationRecoveryPage(view, token) :
        "proposal" in view ? renderPage(view, token) : renderPatchPage(view, token));
      return;
    }
    // Chrome sends Origin: null for a same-origin form POST when the page uses
    // Referrer-Policy: no-referrer. Fetch metadata distinguishes that browser
    // case from a cross-site form while the unguessable token binds the decision.
    const sameOriginPost = request.headers.origin === origin ||
      (request.headers.origin === "null" && request.headers["sec-fetch-site"] === "same-origin");
    if (request.method !== "POST" || request.url !== `/decision/${token}` || decided ||
        !sameOriginPost ||
        request.headers["content-type"] !== "application/x-www-form-urlencoded") {
      response.writeHead(403).end();
      return;
    }
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > 2048) request.destroy();
    });
    request.on("end", () => {
      const values = new URLSearchParams(body);
      const decision = values.get("decision");
      if (values.size !== 2 || values.get("digest") !== boundDigest ||
          (decision !== "approved" && decision !== "rejected")) {
        response.writeHead(400).end();
        return;
      }
      decided = true;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.writeHead(200).end(`<html lang="pt-BR"><meta charset="utf-8"><title>Forge</title><p>Decisão registrada: ${decision === "approved" ? "aprovada" : "rejeitada"}. Você pode fechar esta janela.</p></html>`);
      response.once("finish", () => settle(decision));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
  const timer = setTimeout(() => fail(new Error("Local approval timed out")), timeoutMs);
  try {
    await (options.openBrowser ?? openBrowser)(`${origin}/${token}`);
    return await outcome;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
