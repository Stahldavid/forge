import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { serializeCanonical } from "../compiler/primitives/serialize.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { analyzeImpact, buildImpactTestPlan, detectChangedFiles } from "../impact/index.ts";
import type { ImpactCommandOptions, ImpactSource } from "../impact/types.ts";
import type {
  ReviewChanged,
  ReviewCommandOptions,
  ReviewContext,
  ReviewFailOn,
  ReviewFinding,
  ReviewFindingCategory,
  ReviewFindingSeverity,
  ReviewReport,
  ReviewResult,
  ReviewRisk,
  ReviewRuleDoc,
  ReviewSource,
  ReviewWriteResult,
} from "./types.ts";

const REVIEW_VERSION = "review-0.1.0";
const GENERATED = "src/forge/_generated";
const REVIEW_DIR = ".forge/reviews";

const ALL_CATEGORIES: ReviewFindingCategory[] = [
  "runtime",
  "data",
  "policy",
  "secrets",
  "package",
  "workflow",
  "livequery",
  "frontend",
  "test",
  "deploy",
  "release",
  "agent",
];

const RULE_DOCS: ReviewRuleDoc[] = [
  {
    id: "runtime-command-forbidden-import",
    category: "runtime",
    title: "Command imports side-effect package",
    description: "Commands must stay deterministic and transactional; external network/integration packages belong in actions or workflows.",
    typicalFix: ["Move the side effect to an action or workflow.", "Emit an event from the command with ctx.emit."],
    relatedCommands: ["forge refactor extract-action", "forge make action", "forge repair diagnose"],
  },
  {
    id: "secret-env-example-missing",
    category: "secrets",
    title: "Secret missing from .env.example",
    description: "New required secrets should be documented by name without leaking values.",
    typicalFix: ["Add the secret name to .env.example.", "Run forge secrets check."],
    relatedCommands: ["forge secrets check", "forge refactor replace-process-env <ENV_VAR>"],
  },
  {
    id: "frontend-server-import",
    category: "frontend",
    title: "Frontend imports server-only surface",
    description: "Browser code must use generated client/react surfaces instead of server-only adapters.",
    typicalFix: ["Use src/forge/_generated/react hooks.", "Use the client-safe generated API."],
    relatedCommands: ["forge agent-contract check", "forge test plan --changed"],
  },
  {
    id: "test-high-risk-untested",
    category: "test",
    title: "High risk change lacks targeted test evidence",
    description: "High impact changes should include changed tests or a recent H28 test plan/run record.",
    typicalFix: ["Run forge test plan --changed --write.", "Run forge verify --strict before merge."],
    relatedCommands: ["forge test plan --changed", "forge test run --changed", "forge verify --strict"],
  },
];

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readText(workspaceRoot: string, relative: string): string {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) return "";
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return "";
  }
}

function readJson<T>(workspaceRoot: string, relative: string, fallback: T): T {
  const raw = readText(workspaceRoot, relative);
  if (!raw) return fallback;
  return JSON.parse(stripDeterministicHeader(raw)) as T;
}

function sourceFromOptions(options: ReviewCommandOptions): ReviewSource {
  if (options.staged) return { kind: "staged" };
  if (options.base) return { kind: "base", base: options.base, head: "HEAD" };
  if (options.featureId) return { kind: "feature", featureId: options.featureId };
  if (options.refactorId) return { kind: "refactor", planId: options.refactorId };
  if (options.upgradeId) return { kind: "upgrade", planId: options.upgradeId };
  if (options.releaseId) return { kind: "release", releaseId: options.releaseId };
  return { kind: "changed" };
}

function impactSourceFromReview(source: ReviewSource): ImpactSource {
  if (source.kind === "staged") return { mode: "staged", base: "index" };
  if (source.kind === "base") return { mode: "since", base: source.base };
  if (source.kind === "feature") return { mode: "feature", id: source.featureId };
  if (source.kind === "refactor") return { mode: "refactor", id: source.planId };
  if (source.kind === "upgrade") return { mode: "upgrade", id: source.planId };
  return { mode: "changed", base: "HEAD" };
}

function changedFromFiles(files: string[]): ReviewChanged {
  return {
    files,
    tests: files.filter((file) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)).sort(),
    sourceFiles: files.filter((file) => /\.(ts|tsx|js|jsx)$/.test(file) && !/\.(test|spec)\./.test(file)).sort(),
    generated: files.filter((file) => file.startsWith(`${GENERATED}/`)).sort(),
    packageFiles: files.filter((file) => ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(file) || file.endsWith("/package.json")).sort(),
    deployFiles: files.filter((file) => /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/.test(file) || file.includes("/deploy/") || file.startsWith("deploy/")).sort(),
  };
}

function loadContext(options: ReviewCommandOptions): ReviewContext {
  const source = sourceFromOptions(options);
  const impactSource = impactSourceFromReview(source);
  const detected = detectChangedFiles(options.workspaceRoot, impactSource);
  const changed = changedFromFiles(detected.files);
  const impact = analyzeImpact({
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    write: false,
    changed: impactSource.mode === "changed",
    staged: impactSource.mode === "staged",
    since: impactSource.mode === "since" ? impactSource.base : undefined,
    featureId: impactSource.mode === "feature" ? impactSource.id : undefined,
    refactorId: impactSource.mode === "refactor" ? impactSource.id : undefined,
    upgradeId: impactSource.mode === "upgrade" ? impactSource.id : undefined,
    includeGenerated: false,
    excludeTests: false,
  } satisfies ImpactCommandOptions);
  const fileTexts = new Map<string, string>();
  for (const file of changed.files) fileTexts.set(file, readText(options.workspaceRoot, file));
  return {
    workspaceRoot: options.workspaceRoot,
    source,
    impactSource,
    changed,
    impacted: impact.impacted,
    fileTexts,
    generated: {
      actionSubscriptions: readJson(options.workspaceRoot, `${GENERATED}/actionSubscriptions.json`, {}),
      workflowSubscriptions: readJson(options.workspaceRoot, `${GENERATED}/workflowSubscriptions.json`, {}),
      policyRegistry: readJson(options.workspaceRoot, `${GENERATED}/policyRegistry.json`, {}),
      secretRegistry: readJson(options.workspaceRoot, `${GENERATED}/secretRegistry.json`, {}),
      agentContract: existsSync(join(options.workspaceRoot, `${GENERATED}/agentContract.json`))
        ? readJson(options.workspaceRoot, `${GENERATED}/agentContract.json`, null)
        : null,
    },
    envExample: readText(options.workspaceRoot, ".env.example"),
  };
}

function finding(input: Omit<ReviewFinding, "id">): ReviewFinding {
  const id = `${input.category}_${hashStable(`${input.code}:${input.file ?? ""}:${input.message}`).slice(0, 10)}`;
  return { id, ...input };
}

function basenameNoExt(file: string): string {
  return basename(file).replace(/\.(test|spec)?\.?(ts|tsx|js|jsx|json|md|sql|yml|yaml)$/, "");
}

function isCommandFile(file: string): boolean {
  return normalize(file).includes("/commands/") && /\.(ts|tsx|js|jsx)$/.test(file);
}

function isQueryFile(file: string): boolean {
  return normalize(file).includes("/queries/") && /\.(ts|tsx|js|jsx)$/.test(file);
}

function isLiveQueryFile(file: string): boolean {
  const normalized = normalize(file).toLowerCase();
  return isQueryFile(file) && (normalized.includes("live") || normalized.includes("livequery"));
}

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file) || normalize(file).startsWith("tests/");
}

function isForgeToolingFile(file: string): boolean {
  const normalized = normalize(file);
  return normalized.startsWith("src/forge/cli/") || normalized.startsWith("src/forge/review/");
}

function includesCategory(options: ReviewCommandOptions, category: ReviewFindingCategory): boolean {
  if (options.exclude.includes(category)) return false;
  return options.include.length === 0 || options.include.includes(category);
}

function secretNamesFromText(text: string): string[] {
  const names = new Set<string>();
  for (const regex of [/process\.env\.([A-Z0-9_]+)/g, /process\.env\[['"]([A-Z0-9_]+)['"]\]/g, /ctx\.secrets\.get\(['"]([A-Z0-9_]+)['"]\)/g]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) names.add(match[1]);
  }
  return [...names].sort();
}

function processEnvNamesFromText(text: string): string[] {
  const names = new Set<string>();
  for (const regex of [/process\.env\.([A-Z0-9_]+)/g, /process\.env\[['"]([A-Z0-9_]+)['"]\]/g]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) names.add(match[1]);
  }
  return [...names].sort();
}

function eventNamesFromText(text: string): string[] {
  const events = new Set<string>();
  const regex = /ctx\.emit\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) events.add(match[1]);
  return [...events].sort();
}

function hasSubscriber(ctx: ReviewContext, event: string): boolean {
  return Boolean(
    ctx.generated.actionSubscriptions.byEvent?.[event]?.length ||
      ctx.generated.workflowSubscriptions.byEvent?.[event]?.length ||
      ctx.generated.actionSubscriptions.subscriptions?.some((sub) => sub.eventType === event) ||
      ctx.generated.workflowSubscriptions.subscriptions?.some((sub) => sub.eventType === event),
  );
}

function runtimeRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const [file, text] of ctx.fileTexts) {
    if (isCommandFile(file)) {
      const forbiddenImport = text.match(/from\s+["'](stripe|openai|@aws-sdk\/[^"']+|resend|nodemailer)["']/);
      if (forbiddenImport) {
        findings.push(finding({
          severity: "blocking",
          category: "runtime",
          code: "runtime-command-forbidden-import",
          title: "Command imports side-effect package",
          message: `Command ${basenameNoExt(file)} imports ${forbiddenImport[1]}; move side effects to an action or workflow.`,
          file,
          affected: { commands: [basenameNoExt(file)] },
          suggestedCommands: ["forge refactor extract-action", "forge make action", "forge repair diagnose"],
          autoRepair: { available: true, command: "forge refactor extract-action", confidence: "medium" },
        }));
      }
      if (/ctx\.secrets|ctx\.ai|fetch\s*\(/.test(text)) {
        findings.push(finding({
          severity: "blocking",
          category: "runtime",
          code: "runtime-command-side-effect-capability",
          title: "Command uses forbidden capability",
          message: `Command ${basenameNoExt(file)} uses secrets, AI, or raw network access in a deterministic runtime.`,
          file,
          affected: { commands: [basenameNoExt(file)] },
          suggestedCommands: ["forge refactor extract-action", "forge repair diagnose"],
          autoRepair: { available: true, command: "forge refactor extract-action", confidence: "medium" },
        }));
      }
    }
    if (isQueryFile(file) && /ctx\.db\.(insert|update|delete)|\.(insert|update|delete)\s*\(/.test(text)) {
      findings.push(finding({
        severity: "blocking",
        category: "runtime",
        code: isLiveQueryFile(file) ? "runtime-livequery-write" : "runtime-query-write",
        title: "Read runtime performs writes",
        message: `${isLiveQueryFile(file) ? "LiveQuery" : "Query"} ${basenameNoExt(file)} appears to perform a write.`,
        file,
        affected: isLiveQueryFile(file) ? { liveQueries: [basenameNoExt(file)] } : { queries: [basenameNoExt(file)] },
        suggestedCommands: ["forge check", "forge verify --strict"],
      }));
    }
  }
  return findings;
}

function dataRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const [file, text] of ctx.fileTexts) {
    if (!/(schema|dataGraph)/i.test(file)) continue;
    const mentionsTenant = /tenantId/.test(text);
    const hasTenantIndex = /index\s*\([^)]*tenantId|tenantId[^.\n]*(index|indexed)/i.test(text);
    if (mentionsTenant && !hasTenantIndex) {
      findings.push(finding({
        severity: "warning",
        category: "data",
        code: "data-tenant-index-missing",
        title: "Tenant field may lack index",
        message: "Schema change mentions tenantId but no tenantId index was detected.",
        file,
        affected: { tables: ctx.impacted.data.tables },
        suggestedCommands: ["forge db diff --json", "forge rls check", "forge verify --strict"],
      }));
    }
    if (/required\s*:\s*true|\.notNull\(\)|nullable\s*:\s*false/.test(text)) {
      findings.push(finding({
        severity: "warning",
        category: "data",
        code: "data-required-field-added",
        title: "Required field change needs migration review",
        message: "A required/non-null field appears in a schema diff; confirm existing rows are handled.",
        file,
        affected: { tables: ctx.impacted.data.tables },
        suggestedCommands: ["forge db diff --json", "forge verify --strict"],
      }));
    }
  }
  return findings;
}

function policyRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const [file, text] of ctx.fileTexts) {
    if (!/polic|auth|claims|oidc|jwt/i.test(file)) continue;
    if (/roles?\s*:\s*\[[^\]]*(owner|admin|member|viewer)[^\]]*,[^\]]*(owner|admin|member|viewer)/i.test(text)) {
      findings.push(finding({
        severity: "warning",
        category: "policy",
        code: "policy-widened",
        title: "Policy role set changed",
        message: "Policy/auth change appears to widen or alter role access; confirm this is intentional.",
        file,
        affected: { policies: ctx.impacted.policies },
        suggestedCommands: ["forge policy matrix", "forge policy check --strict-policies", "forge auth check"],
      }));
    }
    if (/allowDevAuth\s*:\s*true|FORGE_AUTH_MODE\s*=\s*dev/i.test(text)) {
      findings.push(finding({
        severity: "blocking",
        category: "policy",
        code: "auth-dev-headers-production",
        title: "Dev auth enabled in auth config",
        message: "Auth changes enable dev-header style auth; do not ship this in production.",
        file,
        suggestedCommands: ["forge auth check", "forge verify --strict"],
      }));
    }
  }
  return findings;
}

function secretRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const documented = ctx.envExample;
  for (const [file, text] of ctx.fileTexts) {
    if (isTestFile(file) || isForgeToolingFile(file)) continue;
    const names = secretNamesFromText(text);
    if (processEnvNamesFromText(text).length > 0) {
      findings.push(finding({
        severity: "error",
        category: "secrets",
        code: "secret-direct-process-env",
        title: "Direct process.env usage introduced",
        message: "ForgeOS code should access secrets through ctx.secrets or generated config context.",
        file,
        suggestedCommands: ["forge secrets check", "forge refactor replace-process-env <ENV_VAR>"],
        autoRepair: { available: true, command: "forge refactor replace-process-env <ENV_VAR>", confidence: "medium" },
      }));
    }
    for (const name of names) {
      if (!documented.includes(name) && !name.startsWith("PUBLIC_") && !name.startsWith("NEXT_PUBLIC_")) {
        findings.push(finding({
          severity: "error",
          category: "secrets",
          code: "secret-env-example-missing",
          title: "Secret missing from .env.example",
          message: `${name} is referenced by changed code but is not documented in .env.example.`,
          file,
          suggestedCommands: ["forge secrets check"],
        }));
      }
      if (/(_SECRET|SECRET_|TOKEN|KEY)/.test(name) && (name.startsWith("PUBLIC_") || name.startsWith("NEXT_PUBLIC_"))) {
        findings.push(finding({
          severity: "blocking",
          category: "secrets",
          code: "public-env-secret",
          title: "Secret-looking variable exposed publicly",
          message: `${name} looks sensitive but uses a public environment prefix.`,
          file,
          suggestedCommands: ["forge secrets check"],
        }));
      }
    }
  }
  return findings;
}

function packageRules(ctx: ReviewContext): ReviewFinding[] {
  if (ctx.changed.packageFiles.length === 0) return [];
  const hasPlan = existsSync(join(ctx.workspaceRoot, ".forge/upgrades"));
  return [finding({
    severity: hasPlan ? "info" : "warning",
    category: "package",
    code: "package-change-without-plan",
    title: "Package files changed",
    message: hasPlan
      ? "Package files changed; confirm the matching upgrade plan applies."
      : "Package files changed but no .forge/upgrades plan directory was found.",
    file: ctx.changed.packageFiles[0],
    affected: { packages: ctx.impacted.packages },
    suggestedCommands: ["forge deps upgrade-plan <package>", "forge deps upgrade-check --json", "forge generate"],
  })];
}

function workflowRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const [file, text] of ctx.fileTexts) {
    if (isTestFile(file)) continue;
    for (const event of eventNamesFromText(text)) {
      if (!hasSubscriber(ctx, event)) {
        findings.push(finding({
          severity: "warning",
          category: "workflow",
          code: "event-no-subscriber",
          title: "Emitted event has no subscriber",
          message: `${event} is emitted but no generated action/workflow subscription was found.`,
          file,
          affected: { commands: isCommandFile(file) ? [basenameNoExt(file)] : undefined },
          suggestedCommands: [`forge make action ${event.replace(/[^a-zA-Z0-9]/g, "-")}`, "forge workflow list", "forge outbox list"],
        }));
      }
    }
  }
  return findings;
}

function liveQueryRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const liveFiles = [...ctx.fileTexts.keys()].filter(isLiveQueryFile);
  if (liveFiles.length > 0 && ctx.changed.tests.filter((file) => /live|query|tenant/i.test(file)).length === 0) {
    findings.push(finding({
      severity: "warning",
      category: "livequery",
      code: "livequery-invalidation-test-missing",
      title: "LiveQuery change lacks targeted live test",
      message: "A liveQuery changed without a changed live/tenant/invalidation test.",
      file: liveFiles[0],
      affected: { liveQueries: liveFiles.map(basenameNoExt) },
      suggestedCommands: ["forge live test", "forge test plan --changed --include live"],
    }));
  }
  for (const file of liveFiles) {
    const text = ctx.fileTexts.get(file) ?? "";
    if (/rawSql|sql`|ctx\.db\.raw/i.test(text)) {
      findings.push(finding({
        severity: "warning",
        category: "livequery",
        code: "livequery-raw-sql-dependency-unknown",
        title: "LiveQuery raw SQL dependency may be unknown",
        message: "Raw SQL in liveQuery can hide dependency tracking from invalidation.",
        file,
        affected: { liveQueries: [basenameNoExt(file)] },
        suggestedCommands: ["forge live debug <subscriptionId>", "forge test plan --changed --include live"],
      }));
    }
  }
  return findings;
}

function frontendRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const [file, text] of ctx.fileTexts) {
    if (!/\.(tsx|jsx)$/.test(file) && !file.startsWith("web/")) continue;
    if (/from\s+["'][^"']*forge\/_generated\/(serverApi|db|runtimeRegistry|secretsContext)|from\s+["'][^"']*\/server["']/.test(text)) {
      findings.push(finding({
        severity: "blocking",
        category: "frontend",
        code: "frontend-server-import",
        title: "Frontend imports server-only generated surface",
        message: "Frontend code imports a server-only Forge surface; use generated client/react hooks instead.",
        file,
        affected: { components: [basenameNoExt(file)] },
        suggestedCommands: ["forge agent-contract check", "forge test plan --changed"],
      }));
    }
    if (/fetch\s*\(\s*["'`]\/?(api|forge|runtime)\//.test(text)) {
      findings.push(finding({
        severity: "warning",
        category: "frontend",
        code: "frontend-direct-runtime-fetch",
        title: "Frontend bypasses generated client",
        message: "Frontend appears to call the runtime directly instead of using the generated client SDK.",
        file,
        affected: { components: [basenameNoExt(file)] },
        suggestedCommands: ["Use src/forge/_generated/react hooks", "Use ForgeProvider"],
      }));
    }
    if (/catch\s*\([^)]*\)\s*{[^}]*console\.error/s.test(text) && !/traceId/.test(text)) {
      findings.push(finding({
        severity: "warning",
        category: "frontend",
        code: "frontend-missing-trace-error",
        title: "Frontend error path may hide traceId",
        message: "Error handling changed without surfacing traceId.",
        file,
        affected: { components: [basenameNoExt(file)] },
      }));
    }
  }
  return findings;
}

function testRules(ctx: ReviewContext, preliminaryRisk: ReviewRisk): ReviewFinding[] {
  const hasLastPlan = existsSync(join(ctx.workspaceRoot, ".forge/test-plans")) || existsSync(join(ctx.workspaceRoot, ".forge/test-runs/last.json"));
  if ((preliminaryRisk.level === "high" || preliminaryRisk.level === "critical") && ctx.changed.tests.length === 0 && !hasLastPlan) {
    return [finding({
      severity: "warning",
      category: "test",
      code: "test-high-risk-untested",
      title: "High risk change lacks test evidence",
      message: "High risk impact detected with no changed tests or stored H28 test plan/run evidence.",
      suggestedCommands: ["forge test plan --changed", "forge test run --changed", "forge verify --strict"],
    })];
  }
  return [];
}

function deployRules(ctx: ReviewContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const file of ctx.changed.deployFiles) {
    const text = ctx.fileTexts.get(file) ?? "";
    if (/ALLOW_DEV_AUTH\s*[:=]\s*["']?true|FORGE_AUTH_MODE\s*[:=]\s*["']?dev|POSTGRES_USER\s*[:=]\s*["']?postgres|DATABASE_URL=.*postgres:postgres/i.test(text)) {
      findings.push(finding({
        severity: "blocking",
        category: "deploy",
        code: /POSTGRES|DATABASE_URL/i.test(text) ? "deploy-db-superuser" : "deploy-dev-auth",
        title: "Deployment config contains unsafe production default",
        message: "Deploy/release file appears to enable dev auth or use a superuser database identity.",
        file,
        suggestedCommands: ["forge self-host check", "forge release check", "forge rls test --db postgres"],
      }));
    }
  }
  return findings;
}

function agentRules(ctx: ReviewContext): ReviewFinding[] {
  const changedAgents = ctx.changed.files.includes("AGENTS.md");
  const changedContract = ctx.changed.generated.some((file) => file.endsWith("agentContract.json") || file.endsWith("agentContract.ts"));
  if (changedAgents && !changedContract) {
    return [finding({
      severity: "warning",
      category: "agent",
      code: "agent-contract-stale",
      title: "Agent contract may be stale",
      message: "AGENTS.md changed without agentContract artifacts changing in the same review source.",
      file: "AGENTS.md",
      suggestedCommands: ["forge agent-contract check", "forge agent export --target generic", "forge agent check"],
    })];
  }
  return [];
}

function releaseRules(ctx: ReviewContext): ReviewFinding[] {
  if (ctx.changed.files.some((file) => file.includes("sourceMap") || file.includes("release") || file.endsWith(".map"))) {
    return [finding({
      severity: "warning",
      category: "release",
      code: "release-review-required",
      title: "Release/source-map surface changed",
      message: "Release or source-map files changed; confirm source maps are not publicly exposed.",
      suggestedCommands: ["forge release check", "forge self-host check"],
    })];
  }
  return [];
}

function riskFor(ctx: ReviewContext, findings: ReviewFinding[]): ReviewRisk {
  let score = 0;
  const reasons: ReviewRisk["reasons"] = [];
  const blockers = findings.filter((finding) => finding.severity === "blocking").map((finding) => finding.code).sort();
  for (const item of findings) {
    const weight = item.severity === "blocking" ? 80 : item.severity === "error" ? 30 : item.severity === "warning" ? 10 : 1;
    score += weight;
    reasons.push({
      code: item.code,
      message: item.title,
      severity: item.severity === "blocking" ? "error" : item.severity,
    });
  }
  const impactWeights: Array<[boolean, number, string]> = [
    [ctx.impacted.data.tables.length > 0, 15, "data schema impact"],
    [ctx.impacted.policies.length > 0, 20, "policy/auth impact"],
    [ctx.changed.packageFiles.length > 0, 30, "package file impact"],
    [ctx.changed.deployFiles.length > 0, 20, "deploy/release impact"],
    [ctx.changed.generated.some((file) => file.includes("rls")), 25, "RLS generated artifact impact"],
    [ctx.impacted.frontend.components.length > 0 || ctx.impacted.frontend.pages.length > 0, 5, "frontend impact"],
  ];
  for (const [active, weight, message] of impactWeights) {
    if (!active) continue;
    score += weight;
    reasons.push({ code: `impact-${message.replace(/[^a-z]+/g, "-")}`, message, severity: weight >= 20 ? "warning" : "info" });
  }
  if (ctx.changed.tests.length > 0) {
    score = Math.max(0, score - 5);
    reasons.push({ code: "tests-added", message: "changed tests present", severity: "info" });
  }
  const level = blockers.length > 0 || score >= 80 ? "critical" : score >= 50 ? "high" : score >= 20 ? "medium" : "low";
  return {
    level,
    score,
    reasons: reasons.sort((a, b) => a.code.localeCompare(b.code)),
    blockers,
  };
}

function preliminaryRisk(ctx: ReviewContext): ReviewRisk {
  return riskFor(ctx, []);
}

function runRules(ctx: ReviewContext, options: ReviewCommandOptions): ReviewFinding[] {
  const groups: Record<ReviewFindingCategory, ReviewFinding[]> = {
    runtime: runtimeRules(ctx),
    data: dataRules(ctx),
    policy: policyRules(ctx),
    secrets: secretRules(ctx),
    package: packageRules(ctx),
    workflow: workflowRules(ctx),
    livequery: liveQueryRules(ctx),
    frontend: frontendRules(ctx),
    deploy: deployRules(ctx),
    release: releaseRules(ctx),
    agent: agentRules(ctx),
    test: [],
  };
  const riskBeforeTests = preliminaryRisk(ctx);
  groups.test = testRules(ctx, riskBeforeTests);
  return ALL_CATEGORIES
    .filter((category) => includesCategory(options, category))
    .flatMap((category) => groups[category])
    .sort((a, b) => `${a.severity}:${a.category}:${a.code}:${a.file ?? ""}`.localeCompare(`${b.severity}:${b.category}:${b.code}:${b.file ?? ""}`));
}

function recommendedCommands(ctx: ReviewContext, findings: ReviewFinding[]): string[] {
  const commands = new Set<string>([
    "forge generate --check",
    "forge check",
    "forge test plan --changed",
    "forge verify --strict",
  ]);
  for (const finding of findings) {
    for (const command of finding.suggestedCommands ?? []) commands.add(command);
  }
  if (ctx.changed.packageFiles.length > 0) commands.add("forge deps upgrade-check --json");
  if (ctx.changed.deployFiles.length > 0) commands.add("forge self-host check");
  return [...commands].sort();
}

function buildReport(options: ReviewCommandOptions): ReviewReport {
  const ctx = loadContext(options);
  const findings = runRules(ctx, options);
  const risk = riskFor(ctx, findings);
  const testPlan = buildImpactTestPlan({
    subcommand: "plan",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    write: false,
    changed: ctx.impactSource.mode === "changed",
    staged: ctx.impactSource.mode === "staged",
    since: ctx.impactSource.mode === "since" ? ctx.impactSource.base : undefined,
    featureId: ctx.impactSource.mode === "feature" ? ctx.impactSource.id : undefined,
    refactorId: ctx.impactSource.mode === "refactor" ? ctx.impactSource.id : undefined,
    upgradeId: ctx.impactSource.mode === "upgrade" ? ctx.impactSource.id : undefined,
    maxCost: options.mode === "quick" ? "fast" : "standard",
    includeDocker: options.mode === "strict",
    includeBrowser: options.mode === "strict",
    bail: false,
  });
  const id = `review_${hashStable(serializeCanonical({
    source: ctx.source,
    files: ctx.changed.files,
    findings: findings.map((item) => [item.code, item.file, item.severity]),
  })).slice(0, 12)}`;
  const generatedPaths = ctx.changed.generated;
  return {
    schemaVersion: "0.1.0",
    reviewVersion: REVIEW_VERSION,
    id,
    source: ctx.source,
    summary: {
      title: "Forge Review",
      bullets: [
        `${ctx.changed.files.length} changed file(s) reviewed.`,
        `${findings.length} finding(s) detected.`,
        `Risk is ${risk.level}.`,
      ],
    },
    risk,
    findings,
    changed: ctx.changed,
    impacted: ctx.impacted,
    checks: [
      { name: "impact-analysis", ok: true, message: `risk ${risk.level}` },
      { name: "test-plan", ok: true, command: "forge test plan --changed", message: `${testPlan.tests.length} targeted test(s)` },
      { name: "generated-drift", ok: true, command: "forge generate --check" },
    ],
    recommendedCommands: recommendedCommands(ctx, findings),
    humanChecklist: [
      { id: "policies", text: "Are new or changed policies intentional?", required: ctx.impacted.policies.length > 0, category: "policy" },
      { id: "tenant-indexes", text: "Are tenant-scoped tables indexed correctly?", required: ctx.impacted.data.tables.length > 0, category: "data" },
      { id: "side-effects", text: "Are commands free of direct side effects?", required: ctx.impacted.runtime.commands.length > 0, category: "runtime" },
      { id: "live-tests", text: "Are liveQueries tested for invalidation and tenant isolation?", required: ctx.impacted.runtime.liveQueries.length > 0, category: "livequery" },
      { id: "secrets", text: "Are new secrets documented without values?", required: findings.some((finding) => finding.category === "secrets"), category: "secrets" },
      { id: "deploy", text: "Are deploy/release changes safe for production?", required: ctx.changed.deployFiles.length > 0, category: "deploy" },
    ],
    agentInstructions: [
      "Fix blocking findings before merge.",
      "Prefer forge repair/refactor/make suggestions when available.",
      "Run targeted checks before forge verify --strict.",
    ],
    generatedArtifacts: {
      paths: generatedPaths,
      stale: findings.filter((finding) => finding.code.includes("agent-contract-stale")).map((finding) => finding.file ?? "AGENTS.md"),
    },
  };
}

function shouldFail(report: ReviewReport, failOn?: ReviewFailOn): boolean {
  if (!failOn) return report.findings.some((finding) => finding.severity === "blocking");
  const order: Record<ReviewFindingSeverity, number> = { info: 0, warning: 1, error: 2, blocking: 3 };
  const threshold = failOn === "warning" ? 1 : failOn === "error" ? 2 : 3;
  return report.findings.some((finding) => order[finding.severity] >= threshold);
}

export function renderReviewMarkdown(report: ReviewReport): string {
  const findings = report.findings.map((item) => `- ${item.severity.toUpperCase()} ${item.code}${item.file ? ` (${item.file})` : ""}: ${item.message}`).join("\n") || "- none";
  return `# Forge Review

Risk: ${report.risk.level} (${report.risk.score})

## Summary

${report.summary.bullets.map((bullet) => `- ${bullet}`).join("\n")}

## Changed Files

${report.changed.files.map((file) => `- ${file}`).join("\n") || "- none"}

## Findings

${findings}

## Recommended Commands

\`\`\`bash
${report.recommendedCommands.join("\n")}
\`\`\`
`;
}

export function renderPrSummary(report: ReviewReport): string {
  return `# PR Summary

## What changed

${report.summary.bullets.map((bullet) => `- ${bullet}`).join("\n")}

## Risk

${report.risk.level}.

## Reviewer focus

${report.humanChecklist.filter((item) => item.required).map((item) => `- ${item.text}`).join("\n") || "- Standard ForgeOS review."}
`;
}

export function renderRiskReport(report: ReviewReport): string {
  return `# Risk Report

Level: ${report.risk.level}
Score: ${report.risk.score}

## Reasons

${report.risk.reasons.map((reason) => `- ${reason.severity} ${reason.code}: ${reason.message}`).join("\n") || "- none"}

## Blockers

${report.risk.blockers.map((blocker) => `- ${blocker}`).join("\n") || "- none"}
`;
}

export function renderHumanChecklist(report: ReviewReport): string {
  return `# Human Review Checklist

${report.humanChecklist.map((item) => `- [ ] ${item.required ? "(required) " : ""}${item.text}`).join("\n")}
`;
}

export function renderTestPlan(report: ReviewReport): string {
  return `# Review Test Plan

\`\`\`bash
${report.recommendedCommands.filter((command) => command.includes("test") || command.includes("verify") || command.includes("check")).join("\n")}
\`\`\`
`;
}

export function renderSarif(report: ReviewReport): string {
  const sarif = {
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "Forge Review",
          informationUri: "https://forgeos.local/review",
          rules: report.findings.map((finding) => ({
            id: finding.code,
            name: finding.title,
            shortDescription: { text: finding.title },
            fullDescription: { text: finding.message },
          })),
        },
      },
      results: report.findings.map((finding) => ({
        ruleId: finding.code,
        level: finding.severity === "blocking" || finding.severity === "error" ? "error" : finding.severity === "warning" ? "warning" : "note",
        message: { text: finding.message },
        locations: finding.file ? [{
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            region: finding.span ? { startLine: finding.span.start, endLine: finding.span.end } : undefined,
          },
        }] : [],
      })),
    }],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

export function writeReviewReport(workspaceRoot: string, report: ReviewReport, includeSarif: boolean): ReviewWriteResult {
  const relativeDir = join(REVIEW_DIR, report.id).replace(/\\/g, "/");
  const dir = join(workspaceRoot, relativeDir);
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["review.json", serializeCanonical(report)],
    ["review.md", renderReviewMarkdown(report)],
    ["pr-summary.md", renderPrSummary(report)],
    ["risk-report.md", renderRiskReport(report)],
    ["test-plan.md", renderTestPlan(report)],
    ["human-checklist.md", renderHumanChecklist(report)],
  ];
  if (includeSarif) files.push(["review.sarif", renderSarif(report)]);
  for (const [file, content] of files) {
    writeFileSync(join(dir, file), content, "utf8");
  }
  return {
    dir: relativeDir,
    files: files.map(([file]) => `${relativeDir}/${file}`),
  };
}

export function explainReviewRule(ruleId: string): ReviewResult {
  const doc = RULE_DOCS.find((rule) => rule.id === ruleId);
  if (!doc) {
    return {
      ok: false,
      diagnostics: [createDiagnostic({ severity: "error", code: "FORGE_REVIEW_RULE_UNKNOWN", message: `unknown review rule: ${ruleId}` })],
      exitCode: 1,
    };
  }
  return {
    ok: true,
    explanation: `Rule: ${doc.id}

${doc.description}

Typical fix:
${doc.typicalFix.map((fix) => `  - ${fix}`).join("\n")}

Related commands:
${doc.relatedCommands.map((command) => `  - ${command}`).join("\n")}
`,
    diagnostics: [],
    exitCode: 0,
  };
}

export function listReviews(workspaceRoot: string): ReviewResult {
  const dir = join(workspaceRoot, REVIEW_DIR);
  if (!existsSync(dir)) return { ok: true, reports: [], diagnostics: [], exitCode: 0 };
  const reports = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, dir: `${REVIEW_DIR}/${entry.name}` }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, reports, diagnostics: [], exitCode: 0 };
}

export function inspectReview(workspaceRoot: string, reviewId: string): ReviewResult {
  const path = join(workspaceRoot, REVIEW_DIR, reviewId, "review.json");
  if (!existsSync(path)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic({ severity: "error", code: "FORGE_REVIEW_NOT_FOUND", message: `review not found: ${reviewId}` })],
      exitCode: 1,
    };
  }
  return {
    ok: true,
    report: JSON.parse(readFileSync(path, "utf8")) as ReviewReport,
    diagnostics: [],
    exitCode: 0,
  };
}

export function runReviewCommand(options: ReviewCommandOptions): ReviewResult {
  if (options.subcommand === "explain") {
    return explainReviewRule(options.ruleId ?? "");
  }
  if (options.subcommand === "list") {
    return listReviews(options.workspaceRoot);
  }
  if (options.subcommand === "inspect") {
    return inspectReview(options.workspaceRoot, options.reviewId ?? "");
  }
  try {
    const report = buildReport(options);
    const writeResult = options.write ? writeReviewReport(options.workspaceRoot, report, options.sarif) : undefined;
    const fail = shouldFail(report, options.failOn);
    return {
      ok: !fail,
      report,
      writeResult,
      diagnostics: fail
        ? [createDiagnostic({ severity: "error", code: "FORGE_REVIEW_BLOCKING_FINDINGS", message: `review failed with risk ${report.risk.level}` })]
        : [],
      exitCode: fail ? 1 : 0,
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [createDiagnostic({ severity: "error", code: "FORGE_REVIEW_OUTPUT_FAILED", message: error instanceof Error ? error.message : "review failed" })],
      exitCode: 1,
    };
  }
}

export function formatReviewJson(result: ReviewResult): string {
  return `${JSON.stringify(result.report ?? result.reports ?? result.explanation ?? result, null, 2)}\n`;
}

export function formatReviewHuman(result: ReviewResult): string {
  if (result.explanation) return result.explanation;
  if (result.reports) {
    return `Forge Reviews

${result.reports.map((report) => `- ${report.id}: ${report.dir}`).join("\n") || "- none"}
`;
  }
  if (!result.report) {
    return `${result.diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`).join("\n")}\n`;
  }
  const report = result.report;
  return `Forge Review

Risk: ${report.risk.level} (${report.risk.score})
Findings: ${report.findings.length}

Blocking issues:
${report.findings.filter((finding) => finding.severity === "blocking").map((finding) => `  - ${finding.code}: ${finding.message}`).join("\n") || "  - none"}

Warnings:
${report.findings.filter((finding) => finding.severity === "warning").map((finding) => `  - ${finding.code}: ${finding.message}`).join("\n") || "  - none"}

Recommended:
${report.recommendedCommands.map((command) => `  - ${command}`).join("\n")}
${result.writeResult ? `\nWritten: ${result.writeResult.dir}\n` : ""}
`;
}
