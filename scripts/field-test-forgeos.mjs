#!/usr/bin/env node
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const args = {
    authProbes: false,
    dryRun: false,
    install: true,
    json: false,
    keep: false,
    runtimeProbes: false,
    uiProbes: false,
    timeoutMs: 180000,
    templates: ["minimal-web"],
    packageManagers: ["npm"],
    writeReport: undefined,
    forgeSpec: `file:${repoRoot}`,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--auth-probes") args.authProbes = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--no-install") args.install = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--runtime-probes") args.runtimeProbes = true;
    else if (arg === "--ui-probes") args.uiProbes = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (arg === "--templates") args.templates = splitList(argv[++index]);
    else if (arg === "--package-managers") args.packageManagers = splitList(argv[++index]);
    else if (arg === "--forge-spec") args.forgeSpec = argv[++index];
    else if (arg === "--write-report") args.writeReport = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.forgeSpec = normalizeForgeSpec(args.forgeSpec);

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  return args;
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeForgeSpec(spec) {
  if (!spec.startsWith("file:")) return spec;
  const fileTarget = spec.slice("file:".length);
  if (fileTarget === "" || fileTarget.startsWith("$") || isAbsolute(fileTarget)) {
    return spec;
  }
  return `file:${resolve(process.cwd(), fileTarget)}`;
}

function commandName(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function commandLine(command, args) {
  return [command, ...args].join(" ");
}

function compactText(text, maxLength = 4000) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.floor(maxLength / 2))}\n...[truncated ${value.length - maxLength} chars]...\n${value.slice(-Math.floor(maxLength / 2))}`;
}

function compactStep(step) {
  return {
    ...step,
    stderr: compactText(step.stderr),
    stdout: compactText(step.stdout),
  };
}

function parseJsonObjectFromOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseJsonObjectsFromOutput(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function waitForDevStartup(readOutput, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = "";
  while (Date.now() < deadline) {
    const output = readOutput();
    lastOutput = output;
    const summaries = parseJsonObjectsFromOutput(output);
    const startup = summaries.find((item) => item?.ok === true && item?.api?.url);
    if (startup) {
      return startup;
    }
    await sleep(250);
  }
  throw new Error(`Forge dev did not emit startup JSON with api.url before timeout. Output: ${compactText(lastOutput, 1200)}`);
}

function summarizeUiErgonomics(step) {
  const payload = parseJsonObjectFromOutput(step.stdout);
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};
  const diagnostics = Array.isArray(data.diagnostics)
    ? data.diagnostics
    : Array.isArray(payload?.diagnostics)
      ? payload.diagnostics
      : [];
  const scenarios = Array.isArray(data.scenarios)
    ? data.scenarios
    : Array.isArray(payload?.scenarios)
      ? payload.scenarios
      : [];
  const manifestSelectors = Array.isArray(data.manifest?.selectors)
    ? data.manifest.selectors
    : Array.isArray(payload?.manifest?.selectors)
      ? payload.manifest.selectors
      : [];
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings
    : diagnostics.filter((item) => item?.severity === "warning");
  const errors = Array.isArray(payload?.errors)
    ? payload.errors
    : diagnostics.filter((item) => item?.severity === "error");
  return {
    command: step.command,
    ok: step.ok && errors.length === 0,
    exitCode: step.exitCode,
    warnings: warnings.length,
    errors: errors.length,
    diagnosticCodes: diagnostics
      .map((item) => item?.code)
      .filter(Boolean)
      .slice(0, 20),
    scenarioNames: scenarios
      .map((item) => item?.name)
      .filter(Boolean)
      .slice(0, 50),
    selectors: manifestSelectors.filter(Boolean).slice(0, 50),
  };
}

function packageScriptArgs(pm, script, extraArgs = []) {
  if (pm === "npm") return ["run", script, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
  return ["run", script, ...extraArgs];
}

async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "sh";
  const args = process.platform === "win32" ? [command] : ["-c", `command -v ${shellQuote(command)}`];
  const result = await runCommand(probe, args, { timeoutMs: 10000, allowFailure: true });
  return result.exitCode === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000;
  const startedAt = Date.now();
  return new Promise((resolveRun, rejectRun) => {
    const spawnTarget = windowsBatchTarget(command, args);
    let child;
    try {
      child = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: options.cwd ?? repoRoot,
        env: { ...process.env, ...(options.env ?? {}) },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      const commandText = commandLine(command, args);
      if (options.allowFailure) {
        resolveRun({
          command: commandText,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          exitCode: 127,
          ok: false,
          stderr: "",
          stdout: "",
          timedOut: false,
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        rejectRun(new Error(`${commandText}: ${message}`));
      }
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const commandText = commandLine(command, args);
      if (options.allowFailure) {
        resolveRun({
          command: commandText,
          durationMs: Date.now() - startedAt,
          error: error.message,
          exitCode: 127,
          ok: false,
          stderr,
          stdout,
          timedOut,
        });
      } else {
        error.message = `${commandText}: ${error.message}`;
        rejectRun(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const result = {
        command: commandLine(command, args),
        durationMs: Date.now() - startedAt,
        exitCode,
        ok: exitCode === 0 && !timedOut,
        stderr,
        stdout,
        timedOut,
      };
      if (!result.ok && !options.allowFailure) {
        const error = new Error(`Command failed: ${result.command}`);
        error.result = result;
        rejectRun(error);
        return;
      }
      resolveRun(result);
    });
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const VENDOR_ACCESS_TENANTS = {
  acme: "11111111-1111-4111-8111-111111111111",
  globex: "22222222-2222-4222-8222-222222222222",
};

function authHeaders(overrides = {}) {
  const permissions = overrides.permissions ?? [];
  return {
    "content-type": "application/json",
    "x-forge-role": overrides.role ?? "owner",
    "x-forge-tenant-id": overrides.tenantId ?? "00000000-0000-0000-0000-000000000001",
    "x-forge-user-id": overrides.userId ?? "field-test-user",
    ...(permissions.length > 0 ? { "x-forge-permissions": JSON.stringify(permissions) } : {}),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    body,
    ok: response.ok,
    status: response.status,
  };
}

async function fetchProbe(url, options = {}) {
  const response = await fetch(url, options);
  const text = options.method === "HEAD" ? "" : await response.text();
  return {
    body: text,
    ok: response.ok,
    status: response.status,
  };
}

function httpStep({ command, result, startedAt, ok }) {
  return {
    command,
    durationMs: Date.now() - startedAt,
    exitCode: ok ? 0 : 1,
    ok,
    status: result.status,
    traceId: result.body?.traceId,
  };
}

function resultRows(result, key) {
  const value = result.body?.result?.[key];
  return Array.isArray(value) ? value : [];
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "not started";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fetchJson(`${url}/health`);
      if (result.ok && result.body?.ok === true) {
        return result;
      }
      lastError = `HTTP ${result.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Dev server did not become healthy at ${url}: ${lastError}`);
}

async function waitForWeb(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "not started";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fetchProbe(url);
      const failureCopy = visibleWebFailureCopy(result.body);
      if (result.ok && /<html|<div\s+id=["']root["']|__nuxt|_next/i.test(result.body)) {
        if (failureCopy) {
          lastError = failureCopy;
          await sleep(500);
          continue;
        }
        return result;
      }
      lastError = `HTTP ${result.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Web server did not become reachable at ${url}: ${lastError}`);
}

function visibleWebFailureCopy(body) {
  const text = String(body ?? "");
  if (/Failed to fetch/i.test(text)) {
    return "web UI rendered 'Failed to fetch'";
  }
  if (/No organization seeded|No organisation seeded/i.test(text)) {
    return "web UI rendered an unseeded-organization state";
  }
  if (/FORGE_DEV_SERVER_ERROR|FORGE_POLICY_DENIED/i.test(text)) {
    return "web UI rendered a raw Forge runtime error";
  }
  return "";
}

function seedCommandsFromEntries(entriesBody) {
  const entries = Array.isArray(entriesBody?.entries) ? entriesBody.entries : [];
  return entries
    .filter((entry) => entry?.kind === "command" && /(^|[._-])seed|seed[A-Z_.-]?/i.test(String(entry.name ?? "")))
    .map((entry) => String(entry.name))
    .sort();
}

async function stopProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const timer = setTimeout(resolveStop, 5000);
      killer.once("close", () => {
        clearTimeout(timer);
        resolveStop();
      });
      killer.once("error", () => {
        clearTimeout(timer);
        resolveStop();
      });
    });
    return;
  }
  child.kill("SIGTERM");
}

function expectedWebText(template) {
  if (template === "vendor-access") return /Vendor Access/i;
  if (template === "b2b-support-web") return /support|ticket|b2b/i;
  return /Forge|Note|Nuxt|Vite|root/i;
}

async function runRuntimeProbes({ appDir, authProbes, packageManager, template, timeoutMs, uiProbes }) {
  const pm = commandName(packageManager);
  const scriptArgs = packageScriptArgs(packageManager, "forge", [
    "dev",
    ...(uiProbes ? ["--web-port", "0"] : ["--api-only"]),
    "--port",
    "0",
    "--json",
    "--skip-startup-console",
  ]);
  const startedAt = Date.now();
  const spawnTarget = windowsBatchTarget(pm, scriptArgs);
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: appDir,
    env: { ...process.env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let childError;
  const steps = [];

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.once("error", (error) => {
    childError = error;
  });

  try {
    if (childError) {
      throw new Error(`Could not start forge dev: ${childError.message}`);
    }

    const startup = await waitForDevStartup(() => stdout, Math.min(timeoutMs, 120000));
    const serverUrl = String(startup.api.url);
    const webUrl = uiProbes && startup.web?.url ? String(startup.web.url) : undefined;
    if (uiProbes && !webUrl) {
      throw new Error(`Forge dev startup JSON did not include web.url while --ui-probes was enabled: ${compactText(JSON.stringify(startup), 1200)}`);
    }
    steps.push({
      command: "forge dev startup",
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      ok: true,
      stdout: JSON.stringify({
        api: startup.api,
        web: startup.web ?? null,
      }),
    });

    const health = await waitForHealth(serverUrl, Math.min(timeoutMs, 120000));
    steps.push({
      command: `GET ${serverUrl}/health`,
      durationMs: Date.now() - startedAt,
      exitCode: 0,
      ok: true,
      status: health.status,
    });

    if (uiProbes && webUrl) {
      const webStartedAt = Date.now();
      const web = await waitForWeb(webUrl, Math.min(timeoutMs, 120000));
      const expected = expectedWebText(template);
      steps.push({
        command: `GET ${webUrl}/`,
        durationMs: Date.now() - webStartedAt,
        exitCode: web.ok && expected.test(web.body) ? 0 : 1,
        ok: web.ok && expected.test(web.body),
        status: web.status,
      });
    }

    const entries = await fetchJson(`${serverUrl}/entries`);
    steps.push({
      command: `GET ${serverUrl}/entries`,
      durationMs: Date.now() - startedAt,
      exitCode: entries.ok ? 0 : 1,
      ok: entries.ok && entries.body?.ok === true,
      status: entries.status,
    });

    const seedCommands = seedCommandsFromEntries(entries.body);
    if (seedCommands.length > 0) {
      const seedCommand = seedCommands[0];
      for (const [label, args] of [
        ["seed-status", ["seed", "status", "--json"]],
        ["seed-dev", ["seed", "dev", "--command", seedCommand, "--url", serverUrl, "--json"]],
        ["seed-reset", ["seed", "reset", "--command", seedCommand, "--url", serverUrl, "--json"]],
      ]) {
        const result = await runCommand(
          pm,
          packageScriptArgs(packageManager, "forge", args),
          { cwd: appDir, timeoutMs, allowFailure: true },
        );
        steps.push({
          ...result,
          command: `${label}: ${result.command}`,
        });
      }
    }

    if (authProbes) {
      for (const [method, path] of [
        ["HEAD", "/auth.md"],
        ["GET", "/auth.md"],
        ["HEAD", "/.well-known/oauth-protected-resource"],
        ["GET", "/.well-known/oauth-protected-resource"],
      ]) {
        const probe = await fetchProbe(`${serverUrl}${path}`, { method });
        steps.push({
          command: `${method} ${serverUrl}${path}`,
          durationMs: Date.now() - startedAt,
          exitCode: probe.ok ? 0 : 1,
          ok: probe.ok,
          status: probe.status,
        });
      }
    }

    if (template === "vendor-access") {
      const ownerPermissions = [
        "demo:seed",
        "vendors:read",
        "vendors:manage",
        "access:request",
        "access:approve",
        "evidence:manage",
        "audit:read",
      ];
      const requesterPermissions = ["vendors:read", "access:request", "audit:read"];
      const acmeOwner = authHeaders({
        tenantId: VENDOR_ACCESS_TENANTS.acme,
        userId: "riley@acme.example",
        role: "owner",
        permissions: ownerPermissions,
      });
      const globexOwner = authHeaders({
        tenantId: VENDOR_ACCESS_TENANTS.globex,
        userId: "nina@globex.example",
        role: "security",
        permissions: ownerPermissions,
      });
      const acmeRequester = authHeaders({
        tenantId: VENDOR_ACCESS_TENANTS.acme,
        userId: "maya@acme.example",
        role: "requester",
        permissions: requesterPermissions,
      });

      const seedAllTenants = await runCommand(
        pm,
        packageScriptArgs(packageManager, "forge", [
          "seed",
          "dev",
          "--command",
          "seedVendorAccessDemo",
          "--url",
          serverUrl,
          "--all-tenants",
          "--json",
        ]),
        { cwd: appDir, timeoutMs, allowFailure: true },
      );
      steps.push({
        ...seedAllTenants,
        command: `vendor-access-seed-all-tenants: ${seedAllTenants.command}`,
      });

      const acmeDashboard = await fetchJson(`${serverUrl}/queries/listVendorAccessDashboard`, {
        body: JSON.stringify({ args: {} }),
        headers: acmeOwner,
        method: "POST",
      });
      const acmeVendors = resultRows(acmeDashboard, "vendors");
      const acmeRequests = resultRows(acmeDashboard, "accessRequests");
      const acmeOrganizations = resultRows(acmeDashboard, "organizations");
      steps.push(httpStep({
        command: `vendor-access-query-acme: POST ${serverUrl}/queries/listVendorAccessDashboard`,
        result: acmeDashboard,
        startedAt,
        ok:
          acmeDashboard.ok &&
          acmeOrganizations.length === 1 &&
          acmeOrganizations.some((organization) => organization.id === VENDOR_ACCESS_TENANTS.acme && organization.name === "Acme Corp") &&
          !acmeOrganizations.some((organization) => organization.id === VENDOR_ACCESS_TENANTS.globex || organization.name === "Globex Security") &&
          acmeVendors.some((vendor) => vendor.name === "Atlas Identity") &&
          !acmeVendors.some((vendor) => vendor.name === "Mercury Cloud"),
      }));

      const globexDashboard = await fetchJson(`${serverUrl}/queries/listVendorAccessDashboard`, {
        body: JSON.stringify({ args: {} }),
        headers: globexOwner,
        method: "POST",
      });
      const globexVendors = resultRows(globexDashboard, "vendors");
      const globexRequests = resultRows(globexDashboard, "accessRequests");
      const globexOrganizations = resultRows(globexDashboard, "organizations");
      steps.push(httpStep({
        command: `vendor-access-query-globex: POST ${serverUrl}/queries/listVendorAccessDashboard`,
        result: globexDashboard,
        startedAt,
        ok:
          globexDashboard.ok &&
          globexOrganizations.length === 1 &&
          globexOrganizations.some((organization) => organization.id === VENDOR_ACCESS_TENANTS.globex && organization.name === "Globex Security") &&
          !globexOrganizations.some((organization) => organization.id === VENDOR_ACCESS_TENANTS.acme || organization.name === "Acme Corp") &&
          globexVendors.some((vendor) => vendor.name === "Mercury Cloud") &&
          !globexVendors.some((vendor) => vendor.name === "Atlas Identity"),
      }));

      const acmePending = acmeRequests.find((request) => request.status === "Pending");
      const globexPending = globexRequests.find((request) => request.status === "Pending");
      const ownerApprove = await fetchJson(`${serverUrl}/commands/approveAccessRequest`, {
        body: JSON.stringify({
          args: {
            requestId: acmePending?.id ?? "missing-request",
            reviewerEmail: "riley@acme.example",
            decision: "Approved",
          },
        }),
        headers: acmeOwner,
        method: "POST",
      });
      steps.push(httpStep({
        command: `vendor-access-owner-approve: POST ${serverUrl}/commands/approveAccessRequest`,
        result: ownerApprove,
        startedAt,
        ok: ownerApprove.ok && ownerApprove.body?.ok === true,
      }));

      const requesterDenied = await fetchJson(`${serverUrl}/commands/approveAccessRequest`, {
        body: JSON.stringify({
          args: {
            requestId: acmePending?.id ?? "missing-request",
            reviewerEmail: "maya@acme.example",
            decision: "Rejected",
          },
        }),
        headers: acmeRequester,
        method: "POST",
      });
      steps.push(httpStep({
        command: `vendor-access-requester-approve-denied: POST ${serverUrl}/commands/approveAccessRequest`,
        result: requesterDenied,
        startedAt,
        ok:
          requesterDenied.status === 403 &&
          /FORGE_POLICY_DENIED|access:approve|denied/i.test(JSON.stringify(requesterDenied.body)),
      }));

      const crossTenantDenied = await fetchJson(`${serverUrl}/commands/approveAccessRequest`, {
        body: JSON.stringify({
          args: {
            requestId: globexPending?.id ?? "missing-request",
            reviewerEmail: "riley@acme.example",
            decision: "Approved",
          },
        }),
        headers: acmeOwner,
        method: "POST",
      });
      steps.push(httpStep({
        command: `vendor-access-cross-tenant-approve-denied: POST ${serverUrl}/commands/approveAccessRequest`,
        result: crossTenantDenied,
        startedAt,
        ok:
          !crossTenantDenied.ok &&
          /not found|current tenant|FORGE_TENANT|tenant/i.test(JSON.stringify(crossTenantDenied.body)),
      }));
    }

    if (template === "minimal-web" || template === "nuxt-web") {
      const create = await fetchJson(`${serverUrl}/commands/createNote`, {
        body: JSON.stringify({ args: { body: "Created by ForgeOS field test.", title: "Field test note" } }),
        headers: authHeaders(),
        method: "POST",
      });
      steps.push({
        command: `POST ${serverUrl}/commands/createNote`,
        durationMs: Date.now() - startedAt,
        exitCode: create.ok && create.body?.ok === true ? 0 : 1,
        ok: create.ok && create.body?.ok === true,
        status: create.status,
        traceId: create.body?.traceId,
      });

      const list = await fetchJson(`${serverUrl}/queries/listNotes`, {
        body: JSON.stringify({ args: {} }),
        headers: authHeaders(),
        method: "POST",
      });
      const notes = Array.isArray(list.body?.result) ? list.body.result : [];
      steps.push({
        command: `POST ${serverUrl}/queries/listNotes`,
        durationMs: Date.now() - startedAt,
        exitCode: list.ok && notes.some((note) => note.title === "Field test note") ? 0 : 1,
        ok: list.ok && notes.some((note) => note.title === "Field test note"),
        status: list.status,
        traceId: list.body?.traceId,
      });
    } else if (template === "b2b-support-web") {
      const create = await fetchJson(`${serverUrl}/commands/createTicket`, {
        body: JSON.stringify({ args: { body: "Created by ForgeOS field test.", title: "Field test ticket" } }),
        headers: authHeaders(),
        method: "POST",
      });
      steps.push({
        command: `POST ${serverUrl}/commands/createTicket`,
        durationMs: Date.now() - startedAt,
        exitCode: create.ok && create.body?.ok === true ? 0 : 1,
        ok: create.ok && create.body?.ok === true,
        status: create.status,
        traceId: create.body?.traceId,
      });

      const list = await fetchJson(`${serverUrl}/queries/listTickets`, {
        body: JSON.stringify({ args: {} }),
        headers: authHeaders(),
        method: "POST",
      });
      const tickets = Array.isArray(list.body?.result) ? list.body.result : [];
      steps.push({
        command: `POST ${serverUrl}/queries/listTickets`,
        durationMs: Date.now() - startedAt,
        exitCode: list.ok && tickets.some((ticket) => ticket.title === "Field test ticket") ? 0 : 1,
        ok: list.ok && tickets.some((ticket) => ticket.title === "Field test ticket"),
        status: list.status,
        traceId: list.body?.traceId,
      });
    }

    return {
      ok: steps.every((step) => step.ok),
      serverUrl,
      webUrl,
      steps: steps.map(compactStep),
      stderr: compactText(stderr),
      stdout: compactText(stdout),
    };
  } finally {
    await stopProcessTree(child);
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 5000);
      child.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }
}

function windowsBatchTarget(command, args) {
  if (process.platform !== "win32" || !command.endsWith(".cmd")) {
    return { args, command };
  }
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/c", command, ...args],
  };
}

async function fieldCase({ appRoot, authProbes, forgeSpec, install, packageManager, runtimeProbes, template, timeoutMs, uiProbes }) {
  const appName = `${template}-${packageManager}-field`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const appDir = join(appRoot, appName);
  const steps = [];
  let uiErgonomics;
  const forgeArgs = [
    join(repoRoot, "bin", "forge.mjs"),
    "new",
    appName,
    "--template",
    template,
    "--package-manager",
    packageManager,
    "--forge-spec",
    forgeSpec,
    "--no-git",
    ...(install ? ["--install"] : ["--no-install"]),
  ];
  steps.push(await runCommand(process.execPath, forgeArgs, { cwd: appRoot, timeoutMs }));

  if (install) {
    const pm = commandName(packageManager);
    steps.push(await runCommand(pm, packageScriptArgs(packageManager, "generate"), { cwd: appDir, timeoutMs }));
    if (authProbes) {
      steps.push(
        await runCommand(pm, packageScriptArgs(packageManager, "forge", ["add", "auth", "workos", "--json"]), {
          cwd: appDir,
          timeoutMs,
        }),
      );
      steps.push(await runCommand(pm, packageScriptArgs(packageManager, "generate"), { cwd: appDir, timeoutMs }));
      steps.push(
        await runCommand(pm, packageScriptArgs(packageManager, "forge", ["authmd", "generate", "--json"]), {
          cwd: appDir,
          timeoutMs,
        }),
      );
      steps.push(
        await runCommand(pm, packageScriptArgs(packageManager, "forge", ["authmd", "check", "--json"]), {
          cwd: appDir,
          timeoutMs,
        }),
      );
      steps.push(
        await runCommand(pm, packageScriptArgs(packageManager, "forge", ["workos", "doctor", "--json"]), {
          cwd: appDir,
          timeoutMs,
        }),
      );
      steps.push(
        await runCommand(
          pm,
          packageScriptArgs(packageManager, "forge", ["workos", "seed", "--file", "workos-seed.yml", "--dry-run", "--json"]),
          { cwd: appDir, timeoutMs },
        ),
      );
      steps.push(
        await runCommand(
          pm,
          packageScriptArgs(packageManager, "forge", ["workos", "prove", "--file", "workos-seed.yml", "--json"]),
          { cwd: appDir, timeoutMs },
        ),
      );
      steps.push(
        await runCommand(pm, packageScriptArgs(packageManager, "forge", ["auth", "prove", "--scenario", "multi-tenant", "--json"]), {
          cwd: appDir,
          timeoutMs,
        }),
      );
    }
    steps.push(
      await runCommand(pm, packageScriptArgs(packageManager, "forge", ["dev", "--once", "--json"]), {
        cwd: appDir,
        timeoutMs,
      }),
    );
    steps.push(
      await runCommand(
        pm,
        packageScriptArgs(packageManager, "forge", ["verify", "--smoke", "--json", "--script-timeout-ms", String(timeoutMs)]),
        { cwd: appDir, timeoutMs },
      ),
    );
    if (uiProbes) {
      const ergonomics = await runCommand(
        pm,
        packageScriptArgs(packageManager, "forge", ["inspect", "ui", "--ergonomics", "--json"]),
        { cwd: appDir, timeoutMs, allowFailure: true },
      );
      steps.push(ergonomics);
      uiErgonomics = summarizeUiErgonomics(ergonomics);
    }

    if (runtimeProbes) {
      const runtime = await runRuntimeProbes({ appDir, authProbes, packageManager, template, timeoutMs, uiProbes });
      steps.push(...runtime.steps);
      return {
        appDir,
        ok: steps.every((step) => step.ok),
        packageManager,
        runtime,
        steps: steps.map(compactStep),
        template,
        uiErgonomics,
      };
    }
  }

  return {
    appDir,
    ok: steps.every((step) => step.ok),
    packageManager,
    steps: steps.map(compactStep),
    template,
    uiErgonomics,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = args.templates.flatMap((template) =>
    args.packageManagers.map((packageManager) => ({ packageManager, template })),
  );

  if (args.dryRun) {
    const plan = {
      authProbes: args.authProbes,
      cases,
      forgeSpec: args.forgeSpec,
      install: args.install,
      ok: true,
      runtimeProbes: args.runtimeProbes,
      uiProbes: args.uiProbes,
      timeoutMs: args.timeoutMs,
    };
    console.log(args.json ? JSON.stringify(plan, null, 2) : `Planned ${cases.length} ForgeOS field test case(s).`);
    return;
  }

  const appRoot = await mkdtemp(join(tmpdir(), "forgeos-field-"));
  const results = [];
  try {
    for (const testCase of cases) {
      const exists = await commandExists(testCase.packageManager);
      if (!exists) {
        results.push({ ...testCase, ok: true, skipped: true, reason: `${testCase.packageManager} not found on PATH` });
        continue;
      }
      results.push(
        await fieldCase({
          appRoot,
          authProbes: args.authProbes,
          forgeSpec: args.forgeSpec,
          install: args.install,
          packageManager: testCase.packageManager,
          runtimeProbes: args.runtimeProbes,
          uiProbes: args.uiProbes,
          template: testCase.template,
          timeoutMs: args.timeoutMs,
        }),
      );
    }
  } finally {
    if (!args.keep) {
      await rm(appRoot, { force: true, maxRetries: 8, recursive: true, retryDelay: 250 });
    } else {
      await access(appRoot).catch(() => undefined);
    }
  }

  const summary = {
    appRoot: args.keep ? appRoot : undefined,
    authProbes: args.authProbes,
    forgeSpec: args.forgeSpec,
    install: args.install,
    ok: results.every((result) => result.ok),
    results,
    runtimeProbes: args.runtimeProbes,
    uiProbes: args.uiProbes,
  };
  if (args.writeReport) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const reportPath = resolve(args.writeReport);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(args.json ? JSON.stringify(summary, null, 2) : humanSummary(summary));
  if (!summary.ok) process.exitCode = 1;
}

function humanSummary(summary) {
  const lines = ["ForgeOS field test"];
  for (const result of summary.results) {
    const status = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
    const runtime = result.runtime?.serverUrl ? ` runtime=${result.runtime.serverUrl}` : "";
    lines.push(`${status} ${result.template} ${result.packageManager}${runtime}`);
  }
  return lines.join("\n");
}

main().catch((error) => {
  const result = error.result ? `\n${JSON.stringify(error.result, null, 2)}` : "";
  console.error(`${error.message}${result}`);
  process.exitCode = 1;
});
