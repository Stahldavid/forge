import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type {
  BrownfieldImportArtifacts,
  BrownfieldImportCommandOptions,
  BrownfieldImportResult,
  ImportedCandidateEntry,
  ImportedDependencyInventory,
  ImportedFrontendCall,
  ImportedInventory,
  ImportedRiskFinding,
  ImportedRiskReport,
  ImportedRoute,
  ImportedRouteSource,
} from "./types.ts";

const IMPORT_DIR = ".forge/import";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".forge",
  ".next",
  ".nuxt",
  ".output",
  "__tests__",
  "_generated",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
  "target",
  "test",
  "tests",
]);
const PREFERRED_SOURCE_ROOTS = ["src", "app", "pages", "server", "web", "apps", "packages"];

export const BROWNFIELD_IMPORT_ARTIFACTS: BrownfieldImportArtifacts = {
  inventory: `${IMPORT_DIR}/inventory.json`,
  routes: `${IMPORT_DIR}/routes.json`,
  frontendCalls: `${IMPORT_DIR}/frontendCalls.json`,
  candidateEntries: `${IMPORT_DIR}/candidateEntries.json`,
  riskReport: `${IMPORT_DIR}/riskReport.json`,
  migrationPlan: `${IMPORT_DIR}/migrationPlan.md`,
  importedAgentContract: `${IMPORT_DIR}/importedAgentContract.json`,
};

interface SourceFile {
  relativePath: string;
  absolutePath: string;
  text: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function artifactPath(workspaceRoot: string, relativePath: string): string {
  return join(workspaceRoot, ...relativePath.split("/"));
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readPackageJson(workspaceRoot: string): Record<string, unknown> {
  return readJson<Record<string, unknown>>(join(workspaceRoot, "package.json")) ?? {};
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

function collectSourceFiles(workspaceRoot: string): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (absoluteDir: string): void => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = join(absoluteDir, entry.name);
      const relativePath = normalizePath(relative(workspaceRoot, absolutePath));
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          !IGNORED_DIRS.has(entry.name) &&
          !relativePath.includes("/src/forge/_generated")
        ) {
          visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name))) {
        continue;
      }
      if (statSync(absolutePath).size > 1_000_000) {
        continue;
      }
      files.push({
        absolutePath,
        relativePath,
        text: readFileSync(absolutePath, "utf8"),
      });
    }
  };
  const preferredRoots = PREFERRED_SOURCE_ROOTS
    .map((name) => join(workspaceRoot, name))
    .filter((absolutePath) => existsSync(absolutePath) && statSync(absolutePath).isDirectory());
  const roots = preferredRoots.length > 0 ? preferredRoots : [workspaceRoot];
  for (const root of roots) {
    visit(root);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function hasAny(names: string[], candidates: string[]): boolean {
  return candidates.some((candidate) => names.includes(candidate));
}

function buildDependencyInventory(workspaceRoot: string): {
  packageName?: string;
  dependencies: ImportedDependencyInventory;
} {
  const pkg = readPackageJson(workspaceRoot);
  const dependencies = objectKeys(pkg.dependencies);
  const devDependencies = objectKeys(pkg.devDependencies);
  const all = [...dependencies, ...devDependencies];
  const scripts = objectKeys(pkg.scripts);
  const frameworks = [
    hasAny(all, ["next"]) ? "next" : null,
    hasAny(all, ["react"]) ? "react" : null,
    hasAny(all, ["vue", "nuxt"]) ? "vue" : null,
    hasAny(all, ["nuxt"]) ? "nuxt" : null,
    hasAny(all, ["express"]) ? "express" : null,
    hasAny(all, ["@nestjs/core"]) ? "nest" : null,
    hasAny(all, ["fastify"]) ? "fastify" : null,
    hasAny(all, ["hono"]) ? "hono" : null,
  ].filter((value): value is string => value !== null);
  const dataPackages = all.filter((name) =>
    ["@prisma/client", "prisma", "drizzle-orm", "typeorm", "mongoose", "sequelize", "knex"].includes(name),
  );
  const externalPackages = all.filter((name) =>
    [
      "stripe",
      "resend",
      "nodemailer",
      "openai",
      "@ai-sdk/openai",
      "@ai-sdk/anthropic",
      "aws-sdk",
      "@aws-sdk/client-s3",
      "sendgrid",
      "@sendgrid/mail",
      "twilio",
    ].includes(name),
  );
  return {
    packageName: typeof pkg.name === "string" ? pkg.name : undefined,
    dependencies: {
      dependencies,
      devDependencies,
      scripts,
      frameworks: Array.from(new Set(frameworks)).sort(),
      dataPackages,
      externalPackages,
    },
  };
}

function stableId(prefix: string, parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function stripExtension(segment: string): string {
  return segment.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/u, "");
}

function normalizeRouteSegment(segment: string): string | null {
  const clean = stripExtension(segment);
  if (clean === "index" || clean === "route" || clean === "page") {
    return null;
  }
  if (clean.startsWith("(") && clean.endsWith(")")) {
    return null;
  }
  const catchAll = clean.match(/^\[\.\.\.(.+)\]$/u);
  if (catchAll) {
    return `:${catchAll[1]}*`;
  }
  const dynamic = clean.match(/^\[(.+)\]$/u);
  if (dynamic) {
    return `:${dynamic[1]}`;
  }
  return clean;
}

function routePathFromFile(relativePath: string, marker: string): string {
  const normalized = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  const markerIndex = normalized.indexOf(marker);
  const afterMarker = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
  const segments = afterMarker
    .split("/")
    .map(normalizeRouteSegment)
    .filter((segment): segment is string => Boolean(segment));
  return `/${segments.join("/")}`.replace(/\/+/gu, "/");
}

function joinRoutePath(base: string, child: string): string {
  return `/${[base, child].map((part) => part.replace(/^\/|\/$/gu, "")).filter(Boolean).join("/")}`.replace(/\/+/gu, "/");
}

function pathIncludesRouteMarker(relativePath: string, marker: string): boolean {
  const normalized = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return normalized.includes(marker);
}

function addRoute(
  routes: ImportedRoute[],
  method: string,
  path: string,
  file: string,
  source: ImportedRouteSource,
  confidence: number,
  handler?: string,
): void {
  routes.push({
    id: stableId("route", [method.toUpperCase(), path, file, source, handler ?? ""]),
    method: method.toUpperCase(),
    path,
    file,
    source,
    handler,
    confidence,
  });
}

function detectRoutes(files: SourceFile[]): ImportedRoute[] {
  const routes: ImportedRoute[] = [];
  const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  for (const file of files) {
    if (pathIncludesRouteMarker(file.relativePath, "/app/api/") && basename(file.relativePath).startsWith("route.")) {
      const path = routePathFromFile(file.relativePath, "/app/");
      for (const method of methods) {
        if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`, "u").test(file.text)) {
          addRoute(routes, method, path, file.relativePath, "next-app-router", 0.92, method);
        }
      }
    }

    if (pathIncludesRouteMarker(file.relativePath, "/pages/api/")) {
      const path = routePathFromFile(file.relativePath, "/pages/");
      addRoute(routes, "ANY", path, file.relativePath, "next-pages-api", 0.78, "default");
    }

    const expressRoute = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]/giu;
    for (const match of file.text.matchAll(expressRoute)) {
      addRoute(routes, match[1] ?? "all", match[2] ?? "/", file.relativePath, "express", 0.84);
    }

    const controller = file.text.match(/@Controller\s*\(\s*["'`]([^"'`]*)["'`]\s*\)/u);
    if (controller) {
      const nestRoute = /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/giu;
      for (const match of file.text.matchAll(nestRoute)) {
        addRoute(
          routes,
          match[1] ?? "All",
          joinRoutePath(controller[1] ?? "", match[2] ?? ""),
          file.relativePath,
          "nest",
          0.78,
        );
      }
    }
  }
  const seen = new Set<string>();
  return routes
    .filter((route) => {
      const key = `${route.method}:${route.path}:${route.file}:${route.source}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.path}:${left.method}`.localeCompare(`${right.path}:${right.method}`));
}

function detectFrontendCalls(files: SourceFile[], routes: ImportedRoute[]): ImportedFrontendCall[] {
  const calls: ImportedFrontendCall[] = [];
  const addCall = (file: string, client: "fetch" | "axios", method: string, url: string): void => {
    const route = routes.find((candidate) => candidate.path === url || url.startsWith(`${candidate.path}/`));
    calls.push({
      id: stableId("call", [file, client, method, url]),
      file,
      client,
      method: method.toUpperCase(),
      url,
      routeId: route?.id,
      confidence: route ? 0.78 : 0.55,
    });
  };
  for (const file of files) {
    if (
      pathIncludesRouteMarker(file.relativePath, "/app/api/") ||
      pathIncludesRouteMarker(file.relativePath, "/pages/api/")
    ) {
      continue;
    }
    const fetchCall = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{(?<options>[\s\S]{0,300}?)\})?/giu;
    for (const match of file.text.matchAll(fetchCall)) {
      const url = match[1] ?? "";
      if (!url.startsWith("/api/") && !url.startsWith("http")) {
        continue;
      }
      const options = match.groups?.options ?? "";
      const method = options.match(/method\s*:\s*["'`]([A-Z]+)["'`]/iu)?.[1] ?? "GET";
      addCall(file.relativePath, "fetch", method, url);
    }
    const axiosMethodCall = /\baxios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/giu;
    for (const match of file.text.matchAll(axiosMethodCall)) {
      const url = match[2] ?? "";
      if (url.startsWith("/api/") || url.startsWith("http")) {
        addCall(file.relativePath, "axios", match[1] ?? "GET", url);
      }
    }
  }
  return calls.sort((left, right) => `${left.file}:${left.url}`.localeCompare(`${right.file}:${right.url}`));
}

function collectEnv(workspaceRoot: string, files: SourceFile[]): ImportedInventory["env"] {
  const names = new Set<string>();
  for (const file of files) {
    for (const match of file.text.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/gu)) {
      names.add(match[1] ?? "");
    }
  }
  const envFiles = [".env", ".env.local", ".env.example", ".env.sample"]
    .filter((name) => existsSync(join(workspaceRoot, name)))
    .sort();
  for (const envFile of envFiles) {
    const raw = readFileSync(join(workspaceRoot, envFile), "utf8");
    for (const line of raw.split(/\r?\n/u)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=/u);
      if (match) {
        names.add(match[1] ?? "");
      }
    }
  }
  return {
    processEnv: Array.from(names).filter(Boolean).sort(),
    envFiles,
  };
}

function sourceTextForRoute(route: ImportedRoute, files: SourceFile[]): string {
  return files.find((file) => file.relativePath === route.file)?.text ?? "";
}

function classifyCandidate(route: ImportedRoute, text: string): Pick<ImportedCandidateEntry, "kind" | "confidence" | "risks" | "evidence" | "needsApproval"> {
  const method = route.method.toUpperCase();
  const lowerPath = route.path.toLowerCase();
  const lowerText = text.toLowerCase();
  const risks = new Set<string>();
  const evidence: string[] = [`${route.source} ${method} ${route.path}`];
  const isQuery = method === "GET" || method === "HEAD";
  const isDestructive = method === "DELETE" || /(delete|remove|destroy|cancel|refund|void|purge)/u.test(lowerPath);
  const writes = /(\.create\(|\.update\(|\.delete\(|\.upsert\(|\.insert\(|\.save\(|\.destroy\(|\.remove\()/u.test(lowerText);
  const external = /(stripe|resend|sendgrid|twilio|nodemailer|openai|anthropic|https?:\/\/|\.send\()/u.test(lowerText);
  const auth = /(auth|session|currentuser|getserversession|clerk|nextauth|requireuser|requireauth)/u.test(lowerText);
  const tenant = /(tenantid|tenant_id|organizationid|orgid|accountid)/u.test(lowerText);
  const methodUnknown = method === "ANY" || method === "ALL";
  if (!isQuery || writes) {
    risks.add("writes-state");
  }
  if (isDestructive) {
    risks.add("destructive");
  }
  if (external) {
    risks.add("external-side-effect");
  }
  if (!auth) {
    risks.add("auth-unknown");
  }
  if (tenant) {
    risks.add("tenant-sensitive");
  }
  if (/\bprocess\.env\./u.test(text)) {
    risks.add("secret-sensitive");
  }
  if (methodUnknown) {
    risks.add("method-unknown");
  }
  const commandLike = !isQuery || writes || isDestructive || external;
  return {
    kind: commandLike ? "command" : "query",
    confidence: commandLike ? (isDestructive ? 0.9 : 0.78) : 0.86,
    risks: Array.from(risks).sort(),
    evidence,
    needsApproval: commandLike || external || isDestructive || methodUnknown,
  };
}

function nameForCandidate(route: ImportedRoute, kind: "command" | "query" | "unknown"): string {
  const nouns = route.path
    .replace(/^\/api\//u, "")
    .replace(/:\w+\*?/gu, "byId")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9]/gu, ""))
    .filter(Boolean);
  const base = nouns.length > 0 ? nouns.join(".") : "imported.route";
  const method = route.method.toUpperCase();
  const action =
    kind === "query" ? "read" :
    method === "POST" ? "create" :
    method === "PUT" || method === "PATCH" ? "update" :
    method === "DELETE" ? "delete" :
    "call";
  return `${base}.${action}`;
}

function buildCandidates(routes: ImportedRoute[], files: SourceFile[]): ImportedCandidateEntry[] {
  const usedNames = new Map<string, number>();
  return routes.map((route) => {
    const text = sourceTextForRoute(route, files);
    const classification = classifyCandidate(route, text);
    const baseName = nameForCandidate(route, classification.kind);
    const count = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${baseName}${count + 1}`;
    return {
      id: stableId("entry", [route.id, name]),
      name,
      kind: classification.kind,
      method: route.method,
      path: route.path,
      routeId: route.id,
      file: route.file,
      origin: "imported",
      assurance: "static-scan",
      reviewStatus: "needs-review",
      visibleToAgent: false,
      needsApproval: classification.needsApproval,
      confidence: classification.confidence,
      risks: classification.risks,
      evidence: classification.evidence,
    };
  });
}

function buildRiskReport(
  routes: ImportedRoute[],
  frontendCalls: ImportedFrontendCall[],
  candidates: ImportedCandidateEntry[],
  files: SourceFile[],
): ImportedRiskReport {
  const findings: ImportedRiskFinding[] = [];
  for (const candidate of candidates) {
    if (candidate.visibleToAgent) {
      findings.push({
        code: "FORGE_IMPORT_VISIBLE",
        severity: "error",
        file: candidate.file,
        routeId: candidate.routeId,
        message: "Imported entries must stay hidden from agents until a human approves them.",
      });
    }
    if (candidate.risks.includes("auth-unknown") && candidate.kind === "command") {
      findings.push({
        code: "FORGE_IMPORT_AUTH_UNKNOWN",
        severity: "warning",
        file: candidate.file,
        routeId: candidate.routeId,
        message: `${candidate.name} looks command-like but static scan did not find an obvious auth guard.`,
      });
    }
    if (candidate.risks.includes("destructive")) {
      findings.push({
        code: "FORGE_IMPORT_DESTRUCTIVE",
        severity: "warning",
        file: candidate.file,
        routeId: candidate.routeId,
        message: `${candidate.name} is destructive and must keep needsApproval=true.`,
      });
    }
    const text = sourceTextForRoute({ ...candidate, id: candidate.routeId, source: "unknown", confidence: 0 }, files);
    if (/\b(req\.body|body|input)\.tenantId\b/u.test(text) || /\b(req\.body|body|input)\.tenant_id\b/u.test(text)) {
      findings.push({
        code: "FORGE_IMPORT_TENANT_SPOOFABLE",
        severity: "warning",
        file: candidate.file,
        routeId: candidate.routeId,
        message: `${candidate.name} appears to accept tenant identity from input; review tenant isolation before migration.`,
      });
    }
  }
  return {
    schemaVersion: "0.1.0",
    summary: {
      routeCount: routes.length,
      frontendCallCount: frontendCalls.length,
      candidateCount: candidates.length,
      commandCount: candidates.filter((candidate) => candidate.kind === "command").length,
      queryCount: candidates.filter((candidate) => candidate.kind === "query").length,
      hiddenFromAgents: candidates.filter((candidate) => !candidate.visibleToAgent).length,
      needsApproval: candidates.filter((candidate) => candidate.needsApproval).length,
    },
    findings,
  };
}

function buildInventory(workspaceRoot: string, files: SourceFile[]): ImportedInventory {
  const dependencyInventory = buildDependencyInventory(workspaceRoot);
  return {
    schemaVersion: "0.1.0",
    origin: "imported",
    assurance: "static-scan",
    workspaceRoot,
    generatedAt: new Date().toISOString(),
    packageName: dependencyInventory.packageName,
    dependencies: dependencyInventory.dependencies,
    filesScanned: files.length,
    sourceFiles: files.map((file) => file.relativePath),
    env: collectEnv(workspaceRoot, files),
  };
}

function buildMigrationPlan(
  inventory: ImportedInventory,
  routes: ImportedRoute[],
  frontendCalls: ImportedFrontendCall[],
  candidates: ImportedCandidateEntry[],
  riskReport: ImportedRiskReport,
): string {
  const lines = [
    "# Brownfield Import Migration Plan",
    "",
    "This plan was produced by `forge import analyze` from static evidence only. Imported entries are hidden from agents until reviewed.",
    "",
    "## Summary",
    "",
    `- Package: ${inventory.packageName ?? "unknown"}`,
    `- Files scanned: ${inventory.filesScanned}`,
    `- Routes detected: ${routes.length}`,
    `- Frontend calls detected: ${frontendCalls.length}`,
    `- Candidate entries: ${candidates.length}`,
    `- Hidden from agents: ${riskReport.summary.hiddenFromAgents}`,
    `- Entries requiring approval: ${riskReport.summary.needsApproval}`,
    "",
    "## Review Order",
    "",
    "1. Review destructive and external-side-effect candidates first.",
    "2. Confirm auth and tenant boundaries before exposing any imported entry.",
    "3. Convert read-only GET candidates into Forge queries only after validating schema ownership.",
    "4. Convert mutating candidates into Forge commands/actions with `ctx.emit` or durable workflows for side effects.",
    "5. Replace frontend raw API calls with generated Forge client bindings after each reviewed migration.",
    "",
    "## Candidate Entries",
    "",
    ...candidates.map((candidate) =>
      `- \`${candidate.name}\` (${candidate.kind}, ${candidate.method} ${candidate.path}) - confidence ${candidate.confidence.toFixed(2)}, risks: ${candidate.risks.join(", ") || "none"}`,
    ),
    "",
    "## Findings",
    "",
    ...(riskReport.findings.length === 0
      ? ["- No high-signal risk findings beyond conservative imported defaults."]
      : riskReport.findings.map((finding) => `- ${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`)),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function buildImportedAgentContract(
  inventory: ImportedInventory,
  routes: ImportedRoute[],
  frontendCalls: ImportedFrontendCall[],
  candidates: ImportedCandidateEntry[],
  riskReport: ImportedRiskReport,
): Record<string, unknown> {
  return {
    schemaVersion: "0.1.0",
    origin: "imported",
    assurance: "static-scan",
    reviewStatus: "needs-review",
    visibleToAgent: false,
    generatedAt: inventory.generatedAt,
    summary: riskReport.summary,
    frameworks: inventory.dependencies.frameworks,
    routes,
    frontendCalls,
    entries: candidates,
    findings: riskReport.findings,
  };
}

function writeArtifact(workspaceRoot: string, relativePath: string, value: unknown): void {
  const absolute = artifactPath(workspaceRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const content = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(absolute, content, "utf8");
}

function analyze(workspaceRoot: string, dryRun: boolean): BrownfieldImportResult {
  const files = collectSourceFiles(workspaceRoot);
  const inventory = buildInventory(workspaceRoot, files);
  const routes = detectRoutes(files);
  const frontendCalls = detectFrontendCalls(files, routes);
  const candidateEntries = buildCandidates(routes, files);
  const riskReport = buildRiskReport(routes, frontendCalls, candidateEntries, files);
  const migrationPlan = buildMigrationPlan(inventory, routes, frontendCalls, candidateEntries, riskReport);
  const importedAgentContract = buildImportedAgentContract(inventory, routes, frontendCalls, candidateEntries, riskReport);
  if (!dryRun) {
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.inventory, inventory);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.routes, routes);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.frontendCalls, frontendCalls);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.candidateEntries, candidateEntries);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.riskReport, riskReport);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.migrationPlan, migrationPlan);
    writeArtifact(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.importedAgentContract, importedAgentContract);
  }
  return {
    schemaVersion: "0.1.0",
    feature: "H49",
    subcommand: "analyze",
    workspaceRoot,
    wroteArtifacts: !dryRun,
    artifacts: BROWNFIELD_IMPORT_ARTIFACTS,
    inventory,
    routes,
    frontendCalls,
    candidateEntries,
    riskReport,
    migrationPlan,
    exitCode: 0,
  };
}

export function inspectBrownfieldImport(workspaceRoot: string): BrownfieldImportResult {
  const inventory = readJson<ImportedInventory>(artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.inventory));
  const routes = readJson<ImportedRoute[]>(artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.routes)) ?? [];
  const frontendCalls =
    readJson<ImportedFrontendCall[]>(artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.frontendCalls)) ?? [];
  const candidateEntries =
    readJson<ImportedCandidateEntry[]>(artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.candidateEntries)) ?? [];
  const riskReport = readJson<ImportedRiskReport>(artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.riskReport));
  const migrationPlanPath = artifactPath(workspaceRoot, BROWNFIELD_IMPORT_ARTIFACTS.migrationPlan);
  const migrationPlan = existsSync(migrationPlanPath) ? readFileSync(migrationPlanPath, "utf8") : null;
  const missing = !inventory || !riskReport;
  return {
    schemaVersion: "0.1.0",
    feature: "H49",
    subcommand: "inspect",
    workspaceRoot,
    wroteArtifacts: false,
    artifacts: BROWNFIELD_IMPORT_ARTIFACTS,
    inventory,
    routes,
    frontendCalls,
    candidateEntries,
    riskReport,
    migrationPlan,
    exitCode: missing ? 1 : 0,
    failureKind: missing ? "missing_import_artifacts" : undefined,
  };
}

export function runBrownfieldImportCommand(options: BrownfieldImportCommandOptions): BrownfieldImportResult {
  if (options.subcommand === "analyze") {
    return analyze(options.workspaceRoot, options.dryRun);
  }
  const result = inspectBrownfieldImport(options.workspaceRoot);
  if (options.entry) {
    result.candidateEntries = result.candidateEntries.filter((entry) => entry.id === options.entry || entry.name === options.entry);
  }
  if (options.target === "routes") {
    result.frontendCalls = [];
    result.candidateEntries = [];
  } else if (options.target === "frontend-calls") {
    result.routes = [];
    result.candidateEntries = [];
  } else if (options.target === "candidate-entries") {
    result.routes = [];
    result.frontendCalls = [];
  }
  return result;
}

export function formatBrownfieldImportJson(result: BrownfieldImportResult): Record<string, unknown> {
  return {
    schemaVersion: result.schemaVersion,
    feature: result.feature,
    subcommand: result.subcommand,
    workspaceRoot: result.workspaceRoot,
    wroteArtifacts: result.wroteArtifacts,
    artifacts: result.artifacts,
    inventory: result.inventory,
    routes: result.routes,
    frontendCalls: result.frontendCalls,
    candidateEntries: result.candidateEntries,
    riskReport: result.riskReport,
    migrationPlan: result.migrationPlan,
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function formatBrownfieldImportHuman(result: BrownfieldImportResult): string {
  if (result.exitCode !== 0 && !result.inventory) {
    return "No brownfield import artifacts found. Run `forge import analyze` first.\n";
  }
  const summary = result.riskReport?.summary;
  return [
    `forge import ${result.subcommand}`,
    `artifacts: ${result.wroteArtifacts ? "written" : "read"} at ${IMPORT_DIR}`,
    `files scanned: ${result.inventory?.filesScanned ?? 0}`,
    `routes: ${summary?.routeCount ?? result.routes.length}`,
    `frontend calls: ${summary?.frontendCallCount ?? result.frontendCalls.length}`,
    `candidate entries: ${summary?.candidateCount ?? result.candidateEntries.length}`,
    `hidden from agents: ${summary?.hiddenFromAgents ?? result.candidateEntries.filter((entry) => !entry.visibleToAgent).length}`,
    `needs approval: ${summary?.needsApproval ?? result.candidateEntries.filter((entry) => entry.needsApproval).length}`,
    "",
  ].join("\n");
}
