import { nodeFileSystem } from "../compiler/fs/index.ts";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { serializeCanonical } from "../compiler/primitives/serialize.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { ApiSurface } from "../compiler/api-surface/build.ts";
import type { AppGraph, SourceFile } from "../compiler/types/app-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import type {
  UiCommandOptions,
  UiCommandResult,
  UiGeneratedArtifacts,
  UiRoute,
  UiRunReport,
  UiScenario,
  UiScenarioResult,
  UiScenarioStep,
  UiScenariosArtifact,
  UiTestManifest,
  UiRoutesArtifact,
} from "./types.ts";

const UI_RUN_VERSION = "ui-run-0.1.0";
const UI_RUN_DIR = ".forge/ui-runs";
const GENERATED = "src/forge/_generated";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function diagnostic(severity: Diagnostic["severity"], code: string, message: string, file?: string): Diagnostic {
  return createDiagnostic({ severity, code, message, ...(file ? { file } : {}) });
}

function readText(workspaceRoot: string, relative: string): string {
  const absolute = join(workspaceRoot, normalize(relative));
  if (!nodeFileSystem.exists(absolute)) return "";
  return (nodeFileSystem.readText(absolute) ?? "");
}

function readJson<T>(workspaceRoot: string, relative: string, fallback: T): T {
  const text = readText(workspaceRoot, relative);
  if (!text) return fallback;
  return JSON.parse(stripDeterministicHeader(text)) as T;
}

function writeText(workspaceRoot: string, relative: string, content: string): void {
  const absolute = join(workspaceRoot, normalize(relative));
  nodeFileSystem.mkdirp(dirname(absolute));
  nodeFileSystem.writeText(absolute, content);
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function walkFiles(root: string, relative = ""): string[] {
  const absolute = relative ? join(root, relative) : root;
  return nodeFileSystem.readDir(absolute).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const normalized = normalize(child);
    if (entry.isDirectory) {
      if (["node_modules", ".next", ".nuxt", "dist", "build", ".vite"].includes(entry.name)) {
        return [];
      }
      return walkFiles(root, normalized);
    }
    return entry.isFile ? [normalized] : [];
  });
}

function listWebSourceFiles(workspaceRoot: string, webRoot: string): Array<{ path: string; text: string }> {
  if (!webRoot) return [];
  const absoluteWebRoot = join(workspaceRoot, normalize(webRoot));
  if (!nodeFileSystem.exists(absoluteWebRoot)) return [];
  return walkFiles(absoluteWebRoot)
    .filter((file) => /\.(tsx|jsx|vue|svelte|html)$/.test(file))
    .map((file) => {
      const path = `${normalize(webRoot)}/${file}`;
      return { path, text: readText(workspaceRoot, path) };
    })
    .filter((source) => source.text.trim().length > 0);
}

function listWebImplementationFiles(workspaceRoot: string, webRoot: string): Array<{ path: string; text: string }> {
  if (!webRoot) return [];
  const absoluteWebRoot = join(workspaceRoot, normalize(webRoot));
  if (!nodeFileSystem.exists(absoluteWebRoot)) return [];
  return walkFiles(absoluteWebRoot)
    .filter((file) => /\.(ts|tsx|js|jsx|mjs|mts|vue|svelte|html)$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .map((file) => {
      const path = `${normalize(webRoot)}/${file}`;
      return { path, text: readText(workspaceRoot, path) };
    })
    .filter((source) => source.text.trim().length > 0);
}

function viteUsesSameOriginProxy(workspaceRoot: string, webRoot: string): boolean {
  const root = normalize(webRoot);
  const configText =
    readText(workspaceRoot, `${root}/vite.config.ts`) ||
    readText(workspaceRoot, `${root}/vite.config.js`) ||
    readText(workspaceRoot, `${root}/vite.config.mts`) ||
    readText(workspaceRoot, `${root}/vite.config.mjs`);
  return /server\s*:\s*\{[\s\S]*proxy\s*:/.test(configText) &&
    /["'`]\/commands["'`]/.test(configText) &&
    /["'`]\/live["'`]/.test(configText);
}

function webConfigProxiesWorkOSSession(workspaceRoot: string, webRoot: string): boolean {
  const root = normalize(webRoot);
  const configText = [
    `${root}/vite.config.ts`,
    `${root}/vite.config.js`,
    `${root}/vite.config.mts`,
    `${root}/vite.config.mjs`,
    `${root}/next.config.ts`,
    `${root}/next.config.js`,
    `${root}/next.config.mjs`,
  ].map((path) => readText(workspaceRoot, path)).join("\n");
  if (!configText.trim()) {
    return false;
  }
  return ["/login", "/callback", "/logout", "/session"].every((route) =>
    new RegExp(`["'\`]${route.replace("/", "\\/")}["'\`]`).test(configText) ||
    new RegExp(`source\\s*:\\s*["'\`]${route.replace("/", "\\/")}["'\`]`).test(configText)
  );
}

function webUsesWorkOSSessionClaims(text: string): boolean {
  if (/\buseForgeWorkOSSession\b/.test(text)) {
    return true;
  }
  return /["'`]\/session["'`]/.test(text) &&
    /\b(claims|organizationId|organization_id|organizationMembershipId|role|roles|permissions)\b/.test(text);
}

function viteBridgeUsesLocalAbsoluteUrl(workspaceRoot: string, webRoot: string): string | null {
  const root = normalize(webRoot);
  const candidates = [
    `${root}/src/lib/forge.ts`,
    `${root}/src/lib/forge.tsx`,
    `${root}/lib/forge.ts`,
    `${root}/lib/forge.tsx`,
  ];
  for (const candidate of candidates) {
    const text = readText(workspaceRoot, candidate);
    if (!text) {
      continue;
    }
    if (/export\s+const\s+forgeUrl[\s\S]*127\.0\.0\.1:3765/.test(text) && !/useSameOrigin/.test(text)) {
      return candidate;
    }
  }
  return null;
}

function readOptionalGeneratedJson(workspaceRoot: string, name: string): unknown {
  try {
    return readJson<unknown>(workspaceRoot, `${GENERATED}/${name}`, null);
  } catch {
    return null;
  }
}

function hasTenantScopedData(workspaceRoot: string): boolean {
  const dataGraph = readOptionalGeneratedJson(workspaceRoot, "dataGraph.json") as { tables?: Array<Record<string, unknown>> } | null;
  return (dataGraph?.tables ?? []).some((table) =>
    table?.tenantScoped === true ||
    table?.tenantScope === true ||
    typeof table?.tenantField === "string" ||
    (Array.isArray(table?.fields) && table.fields.some((field) =>
      typeof field === "object" &&
      field !== null &&
      ("tenantId" === (field as { name?: string }).name || "tenant_id" === (field as { name?: string }).name)
    ))
  );
}

function isProductionAuthModeValue(value: unknown): boolean {
  return value === "jwt" || value === "oidc";
}

function hasExplicitProductionAuthShape(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["mode", "defaultMode", "activeMode", "authMode", "productionMode", "authProvider"]) {
    if (isProductionAuthModeValue(record[key])) {
      return true;
    }
  }
  if (record.production === true || isProductionAuthModeValue(record.production)) {
    return true;
  }
  if (record.production && typeof record.production === "object") {
    return hasExplicitProductionAuthShape(record.production);
  }
  return false;
}

function hasProductionAuthMode(workspaceRoot: string): boolean {
  const agentContract = readOptionalGeneratedJson(workspaceRoot, "agentContract.json") as { auth?: unknown } | null;
  const authConfig = readOptionalGeneratedJson(workspaceRoot, "authConfig.json");
  const authRegistry = readOptionalGeneratedJson(workspaceRoot, "authRegistry.json");
  return hasExplicitProductionAuthShape(agentContract?.auth) ||
    hasExplicitProductionAuthShape(authConfig) ||
    hasExplicitProductionAuthShape(authRegistry) ||
    hasWorkOSIntegration(workspaceRoot);
}

function looksLikeAuthFlow(text: string): boolean {
  return /sign\s*in|signin|login|logout|authkit|organization|tenant|session|workos|clerk|auth0/i.test(text);
}

function hasVisibleWorkOSAuthControl(text: string): boolean {
  return /<(a|button)\b[^>]*(href|data-forge-testid)=["'][^"']*(\/login|\/logout)[^"']*["']/i.test(text) ||
    /<(button|a)\b[\s\S]*?\b((sign\s*in|log\s*in|continue)\s+(with\s+)?(workos|authkit)|(workos|authkit)\s+(sign\s*in|login)|sign\s*out)\b[\s\S]*?<\/(button|a)>/i.test(text) &&
      /\b(workos|authkit|auth\.signIn|auth\.signOut|signIn\s*\(|signOut\s*\()/.test(text) ||
    /\b(auth|workosAuth)\.(signIn|signOut)\s*\(/.test(text) ||
    /\buseWorkOSAuth\b[\s\S]{0,500}\b(signIn|signOut)\s*\(/.test(text);
}

function hasWorkOSIntegration(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, `${GENERATED}/integrations/workos/authkit.ts`)) ||
    nodeFileSystem.exists(join(workspaceRoot, `${GENERATED}/integrations/workos/auth-routes.ts`));
}

function webPackageHasAuthKit(workspaceRoot: string): boolean {
  const path = join(workspaceRoot, "web/package.json");
  if (!nodeFileSystem.exists(path)) return false;
  try {
    const packageJson = JSON.parse(nodeFileSystem.readText(path) ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(packageJson.dependencies?.["@workos-inc/authkit-react"] ?? packageJson.devDependencies?.["@workos-inc/authkit-react"]);
  } catch {
    return false;
  }
}

type UiPackageManager = "bun" | "npm" | "pnpm" | "yarn";

interface UiPackageContext {
  packageRoot: string;
  packageRootLabel: string;
  packageManager: UiPackageManager;
  hasPackageJson: boolean;
  hasPlaywrightDependency: boolean;
  playwrightInstalled: boolean;
  installCommands: string[];
  installDependencyCommand: string;
  installBrowsersCommand: string;
}

function readPackageJson(workspaceRoot: string, relative: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) return null;
  try {
    return JSON.parse(nodeFileSystem.readText(absolute) ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function detectPackageManager(workspaceRoot: string, packageRootLabel: string): UiPackageManager {
  const roots = [packageRootLabel, ""].filter((root, index, array) => array.indexOf(root) === index);
  for (const root of roots) {
    const prefix = root ? `${root}/` : "";
    if (nodeFileSystem.exists(join(workspaceRoot, `${prefix}pnpm-lock.yaml`))) return "pnpm";
    if (nodeFileSystem.exists(join(workspaceRoot, `${prefix}bun.lock`)) || nodeFileSystem.exists(join(workspaceRoot, `${prefix}bun.lockb`))) return "bun";
    if (nodeFileSystem.exists(join(workspaceRoot, `${prefix}yarn.lock`))) return "yarn";
    if (nodeFileSystem.exists(join(workspaceRoot, `${prefix}package-lock.json`))) return "npm";
  }
  return "npm";
}

function playwrightInstallCommands(packageManager: UiPackageManager): {
  installDependencyCommand: string;
  installBrowsersCommand: string;
} {
  if (packageManager === "pnpm") {
    return {
      installDependencyCommand: "pnpm add -D @playwright/test",
      installBrowsersCommand: "pnpm exec playwright install",
    };
  }
  if (packageManager === "bun") {
    return {
      installDependencyCommand: "bun add -d @playwright/test",
      installBrowsersCommand: "bunx playwright install",
    };
  }
  if (packageManager === "yarn") {
    return {
      installDependencyCommand: "yarn add -D @playwright/test",
      installBrowsersCommand: "yarn playwright install",
    };
  }
  return {
    installDependencyCommand: "npm install -D @playwright/test",
    installBrowsersCommand: "npx playwright install",
  };
}

function hasPlaywrightDependency(packageJson: ReturnType<typeof readPackageJson>): boolean {
  return Boolean(
    packageJson?.dependencies?.playwright ||
    packageJson?.devDependencies?.playwright ||
    packageJson?.dependencies?.["@playwright/test"] ||
    packageJson?.devDependencies?.["@playwright/test"],
  );
}

function uiPackageContext(workspaceRoot: string, manifest: UiTestManifest): UiPackageContext {
  const webPackage = manifest.webRoot ? readPackageJson(workspaceRoot, `${normalize(manifest.webRoot)}/package.json`) : null;
  const rootPackage = readPackageJson(workspaceRoot, "package.json");
  const packageRootLabel = webPackage && manifest.webRoot ? normalize(manifest.webRoot) : "";
  const packageRoot = join(workspaceRoot, packageRootLabel);
  const packageJson = webPackage ?? rootPackage;
  const packageManager = detectPackageManager(workspaceRoot, packageRootLabel);
  const commands = playwrightInstallCommands(packageManager);
  const installedRoots = [
    packageRootLabel,
    "",
  ].filter((root, index, array) => array.indexOf(root) === index);
  const playwrightInstalled = installedRoots.some((root) => {
    const prefix = root ? `${root}/` : "";
    return nodeFileSystem.exists(join(workspaceRoot, `${prefix}node_modules/playwright`)) ||
      nodeFileSystem.exists(join(workspaceRoot, `${prefix}node_modules/@playwright/test`));
  });
  return {
    packageRoot,
    packageRootLabel: packageRootLabel || ".",
    packageManager,
    hasPackageJson: Boolean(packageJson),
    hasPlaywrightDependency: hasPlaywrightDependency(packageJson),
    playwrightInstalled,
    installCommands: [commands.installDependencyCommand, commands.installBrowsersCommand],
    ...commands,
  };
}

function hasMainLandmark(text: string): boolean {
  return /<main[\s>]|role=["']main["']|<header[\s>]|<nav[\s>]/i.test(text);
}

function hasRuntimeDataHook(text: string): boolean {
  return /\b(useLiveQuery|useQuery|useForgeLiveQuery|useForgeQuery)\b/.test(text);
}

function hasStateText(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function hasProductDemoCopy(text: string): boolean {
  return /production-shaped\s+ForgeOS|ForgeOS\s+app\s+with|ForgeOS\s+[^<>{}\n]{0,48}\bdemo\b|powered\s+by\s+ForgeOS|demonstrat(?:e|ing)\s+ForgeOS|agent-readable\s+demo|WorkOS-style\s+permissions/i.test(text);
}

function stripCollapsibleDetails(text: string): string {
  return text.replace(/<details\b[\s\S]*?<\/details>/gi, "");
}

function hasDemoAuthCopy(text: string): boolean {
  return /\bdemo\s+(login|account|user|identity|password|credentials?)\b/i.test(text) ||
    /\b(login|sign\s*in)\s+as\s+demo\b/i.test(text);
}

function hasLocalIdentityControl(text: string): boolean {
  return /data-forge-testid=["'][^"']*(persona|dev-auth|local-identity|login-persona)[^"']*["']/i.test(text) ||
    /\b(persona|devAuth|dev\s+auth|local\s+identity|local\s+account|workspace\s+account)\b/i.test(text) ||
    /\bx-forge-(role|permissions|tenant-id|user-id)\b/i.test(text);
}

function hasLocalAuthBoundaryCopy(text: string): boolean {
  return /\b(local|development|dev|test)\s+(mode|identity|account|auth|session|sign[-\s]?in|login)\b/i.test(text) ||
    /\b(use|switch|select)\s+(a\s+)?(local|dev|development|test)\s+(identity|account|persona)\b/i.test(text) ||
    /\bnot\s+(production|real)\s+auth\b/i.test(text) ||
    /\bproduction\s+auth\s+(uses|requires|is)\s+(WorkOS|AuthKit|OIDC|JWT)\b/i.test(text);
}

function hasFakeCredentialAuthForm(text: string): boolean {
  if (!/<input\b[^>]*type=["']?password["']?/i.test(text)) {
    return false;
  }
  return /\b(forge-demo|demo\s+password|test\s+password|fake\s+password|any\s+password|password\s+is\s+ignored)\b/i.test(text) ||
    /\b(local|demo|fake|mock)\s+(login|auth|credentials?)\b/i.test(text);
}

function hasExposedDevDiagnostics(text: string): boolean {
  return /\b(WORKOS_[A-Z0-9_]+|FORGE_AUTH_[A-Z0-9_]+|x-forge-[a-z0-9-]+|workos-seed\.ya?ml|agentContract|capability\s+map|policy\s+proof|debug\s+claims|raw\s+claims)\b/i.test(text) ||
    /JSON\.stringify\s*\(\s*(session|claims|permissions|persona|devAuth)\b/i.test(text) ||
    /<pre\b[\s\S]{0,240}\b(claims|permissions|devAuth|workos|seedCommand|agentContract)\b/i.test(text);
}

function hasNetworkRecoveryHint(text: string): boolean {
  if (!/Failed to fetch|not reachable|cannot reach|network error/i.test(text)) return true;
  return /\/health|npm run dev|vite\.config|proxy|CORS|127\.0\.0\.1|localhost/i.test(text);
}

function hasSeedExperience(text: string): boolean {
  return /data-forge-testid=["'][^"']*(seed|reset)[^"']*["']/i.test(text) ||
    /\b(load|refresh|reset|prepare|preparing|rebuild|restore)\s+(tenant|workspace|demo|sample)?\s*(data|workspace|tenant)\b/i.test(text) ||
    /\btenant\s+data\s+(ready|loading|prepared)\b/i.test(text) ||
    /\b(seed\s+status|auto-seed|auto-seeds|empty\s+workspace\s+recovery)\b/i.test(text);
}

function hasAutomaticSeedRecovery(text: string): boolean {
  return /useEffect\s*\([\s\S]{0,3000}\b(runSeed|seed[A-Za-z0-9_]*\.run|seedWorkspace\.run|seedVendorAccessDemo\.run)\b/i.test(text) &&
    /\b(length\s*===\s*0|No\s+\w+|empty|tenantSeedState|workspace\s+is\s+empty|first[-\s]?run)\b/i.test(text);
}

function findFormWithoutLabel(text: string): boolean {
  if (!/<(form|input|select|textarea)\b/i.test(text)) return false;
  const controls = text.match(/<(input|select|textarea)\b[^>]*>/gi) ?? [];
  return controls.some((control) => {
    if (/\b(type=["']?(hidden|submit|button|checkbox|radio)["']?)/i.test(control)) return false;
    if (/\b(aria-label|aria-labelledby|title)=/i.test(control)) return false;
    const id = /\bid=["']([^"']+)["']/i.exec(control)?.[1];
    if (id && new RegExp(`<label\\b[^>]*\\bfor=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(text)) {
      return false;
    }
    return !/<label\b/i.test(text);
  });
}

function findUnnamedButton(text: string): boolean {
  const buttons = text.match(/<button\b[\s\S]*?<\/button>/gi) ?? [];
  return buttons.some((button) => {
    if (/\b(aria-label|aria-labelledby|title)=/i.test(button)) return false;
    const inner = button.replace(/<button\b[^>]*>/i, "").replace(/<\/button>/i, "").replace(/<[^>]+>/g, "").trim();
    return inner.length === 0;
  });
}

function hasPrimaryWorkflowAction(text: string): boolean {
  return /<(form|button)\b/i.test(text) &&
    /\b(useCommand|useForgeCommand|onSubmit|onClick|type=["']submit["']|data-forge-testid=["'][^"']*(create|add|approve|request|invite|seed|save|update|submit))/i.test(text);
}

function hasPermissionFeedback(text: string): boolean {
  return /\b(can[A-Z]\w*|permissions\.includes|FORGE_POLICY_DENIED|policy-denied|permission|forbidden|denied|disabled=|aria-disabled)\b/i.test(text);
}

function hasWorkflowNavigation(text: string): boolean {
  return /<nav[\s>]|aria-label=["'][^"']*(section|navigation|workspace|nav)|href=["']#/i.test(text) ||
    ((text.match(/<section\b/gi) ?? []).length >= 2 && /<header[\s>]/i.test(text));
}

function routeName(path: string): string {
  if (path === "/") return "home";
  return path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-") || "route";
}

function detectRoutesFromSources(sources: SourceFile[]): UiRoute[] {
  const routes: UiRoute[] = [];
  for (const source of sources) {
    const path = normalize(source.path);
    if (!path.startsWith("web/app/") || !path.endsWith("/page.tsx")) continue;
    const route = path
      .replace(/^web\/app/, "")
      .replace(/\/page\.tsx$/, "") || "/";
    routes.push({
      path: route,
      name: routeName(route),
      uses: {
        commands: [],
        queries: [],
        liveQueries: [],
        components: [],
      },
    });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function defaultRoutes(api: ApiSurface, sources: SourceFile[]): UiRoute[] {
  const routes = detectRoutesFromSources(sources);
  if (!routes.some((route) => route.path === "/")) {
    routes.unshift({
      path: "/",
      name: "home",
      uses: { commands: [], queries: [], liveQueries: [], components: [] },
    });
  }
  const commandNames = Object.keys(api.commands).sort();
  const liveQueryNames = Object.keys(api.liveQueries).sort();
  if (
    (commandNames.some((name) => /ticket/i.test(name)) ||
      liveQueryNames.some((name) => /ticket/i.test(name))) &&
    !routes.some((route) => route.path === "/tickets")
  ) {
    routes.push({
      path: "/tickets",
      name: "tickets",
      uses: {
        commands: commandNames.filter((name) => /ticket|billing/i.test(name)),
        queries: Object.keys(api.queries).filter((name) => /ticket/i.test(name)).sort(),
        liveQueries: liveQueryNames.filter((name) => /ticket/i.test(name)),
        components: ["TicketList", "CreateTicketForm"],
      },
    });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function emptyRequires(): UiScenario["requires"] {
  return {
    commands: [],
    queries: [],
    liveQueries: [],
    policies: [],
    components: [],
    workflows: [],
  };
}

function buildDefaultScenarios(api: ApiSurface, appGraph: AppGraph, routes: UiRoute[]): UiScenario[] {
  const commands = Object.keys(api.commands).sort();
  const liveQueries = Object.keys(api.liveQueries).sort();
  const workflows = Object.keys(api.workflows).sort();
  const policies = appGraph.symbols.filter((symbol) => symbol.kind === "policy").map((symbol) => symbol.name).sort();
  const scenarios: UiScenario[] = [
    {
      name: "home-loads",
      description: "Load the home route and verify the app renders.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "expectVisible", selector: "[data-forge-testid='app-root'], body" },
      ],
      requires: emptyRequires(),
    },
  ];

  if (routes.some((route) => route.path === "/tickets")) {
    scenarios.push({
      name: "tickets-page-loads",
      description: "Load the tickets page and verify the generated form/list selectors.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "expectVisible", selector: "[data-forge-testid='ticket-title-input']" },
        { kind: "expectVisible", selector: "[data-forge-testid='ticket-list']" },
      ],
      requires: {
        ...emptyRequires(),
        components: ["CreateTicketForm", "TicketList"],
      },
    });
    scenarios.push({
      name: "tickets-live-update",
      description: "Create a ticket and verify liveQuery updates the ticket list.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "fill", selector: "[data-forge-testid='ticket-title-input']", value: "Ticket from UI smoke" },
        { kind: "click", selector: "[data-forge-testid='create-ticket-button']" },
        { kind: "expectText", selector: "[data-forge-testid='ticket-list']", text: "Ticket from UI smoke", timeoutMs: 5000 },
        { kind: "waitForLiveRevision", minRevision: 1, timeoutMs: 5000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /create.*ticket|ticket.*create/i.test(name)),
        liveQueries: liveQueries.filter((name) => /ticket/i.test(name)),
        policies: policies.filter((name) => /tickets\.(create|read)/i.test(name)),
        components: ["CreateTicketForm", "TicketList"],
      },
    });
    scenarios.push({
      name: "policy-denied-visible",
      description: "Verify policy denied errors surface with a traceId.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "click", selector: "[data-forge-testid='billing-manage-demo']" },
        { kind: "expectText", selector: "[data-forge-testid='policy-denied-error']", text: "FORGE_POLICY_DENIED", timeoutMs: 5000 },
        { kind: "expectText", selector: "[data-forge-testid='policy-denied-error']", text: "trace", timeoutMs: 5000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /billing/i.test(name)),
        policies: policies.filter((name) => /billing\.manage/i.test(name)),
        components: ["TicketList"],
      },
    });
  }

  const hasVendorAccessFlow =
    commands.some((name) => /^(approveAccessRequest|createAccessRequest|seedVendorAccessDemo|addEvidence)$/i.test(name)) ||
    liveQueries.some((name) => /vendorAccess/i.test(name));
  if (hasVendorAccessFlow) {
    scenarios.push({
      name: "vendor-access-local-login",
      description: "Sign in with a local development identity and verify the vendor workspace shell renders.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "expectVisible", selector: "[data-forge-testid='login-submit']", timeoutMs: 5000 },
        { kind: "click", selector: "[data-forge-testid='login-submit']" },
        { kind: "expectVisible", selector: "[data-forge-testid='vendor-list']", timeoutMs: 10000 },
        { kind: "expectVisible", selector: "[data-forge-testid='approval-queue']", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /seedVendorAccessDemo/i.test(name)),
        liveQueries: liveQueries.filter((name) => /vendorAccess/i.test(name)),
        components: ["App"],
      },
    });
    scenarios.push({
      name: "vendor-access-autoseed-data-visible",
      description: "Verify the first-run workspace recovers seeded vendor data after local sign-in.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "click", selector: "[data-forge-testid='login-submit']" },
        { kind: "expectVisible", selector: "[data-forge-testid='vendor-list']", timeoutMs: 10000 },
        { kind: "expectText", selector: "[data-forge-testid='vendor-list']", text: "Atlas Identity", timeoutMs: 10000 },
        { kind: "expectText", selector: "[data-forge-testid='approval-queue']", text: "SCIM production tenant", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /seedVendorAccessDemo/i.test(name)),
        liveQueries: liveQueries.filter((name) => /vendorAccess/i.test(name)),
        components: ["App"],
      },
    });
    scenarios.push({
      name: "vendor-access-requester-denied-visible",
      description: "Select a requester persona and verify approval denial feedback is visible.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "selectOption", selector: "[data-forge-testid='login-persona']", value: "acme-requester" },
        { kind: "click", selector: "[data-forge-testid='login-submit']" },
        { kind: "expectVisible", selector: "[data-forge-testid='policy-denied-approval']", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /approveAccessRequest/i.test(name)),
        liveQueries: liveQueries.filter((name) => /vendorAccess/i.test(name)),
        policies: policies.filter((name) => /access:approve|approve/i.test(name)),
        components: ["App"],
      },
    });
    scenarios.push({
      name: "vendor-access-seed-control-visible",
      description: "Verify the developer seed control is available after local sign-in.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "click", selector: "[data-forge-testid='login-submit']" },
        { kind: "click", selector: "[data-forge-testid='dev-diagnostics-toggle']" },
        { kind: "expectVisible", selector: "[data-forge-testid='seed-demo']", timeoutMs: 10000 },
        { kind: "expectVisible", selector: "[data-forge-testid='reset-demo']", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /seedVendorAccessDemo/i.test(name)),
        liveQueries: liveQueries.filter((name) => /vendorAccess/i.test(name)),
        components: ["App"],
      },
    });
  }

  if (workflows.some((name) => /triage|ai/i.test(name))) {
    scenarios.push({
      name: "ai-triage-mock-visible",
      description: "Create a ticket and verify AI mock workflow output appears.",
      route: "/tickets",
      cost: "slow",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "fill", selector: "[data-forge-testid='ticket-title-input']", value: "AI triage smoke" },
        { kind: "click", selector: "[data-forge-testid='create-ticket-button']" },
        { kind: "expectVisible", selector: "[data-forge-testid='triage-summary']", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /ticket/i.test(name)),
        liveQueries: liveQueries.filter((name) => /ticket/i.test(name)),
        workflows: workflows.filter((name) => /triage|ai/i.test(name)),
        components: ["TicketList"],
      },
    });
  }

  return scenarios.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildUiGeneratedArtifacts(input: {
  appGraph: AppGraph;
  apiSurface: ApiSurface;
  frontendGraph?: FrontendGraph;
  sources: SourceFile[];
  workspaceRoot?: string;
}): UiGeneratedArtifacts {
  const frontendRoutes = (input.frontendGraph?.routes ?? []).map((route): UiRoute => ({
    path: route.path,
    name: route.path === "/" ? "home" : route.path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "-") || "route",
    uses: {
      commands: route.usesCommands,
      queries: route.usesQueries,
      liveQueries: route.usesLiveQueries,
      components: route.components,
    },
  }));
  const routes = frontendRoutes.length > 0 ? frontendRoutes : defaultRoutes(input.apiSurface, input.sources);
  const scenarios = buildDefaultScenarios(input.apiSurface, input.appGraph, routes);
  const webRoot = input.frontendGraph?.root ??
    (input.sources.some((source) => source.path.startsWith("web/")) ||
      (input.workspaceRoot ? nodeFileSystem.exists(join(input.workspaceRoot, "web")) : false)
      ? "web"
      : "");
  const frameworkFromFrontend =
    input.frontendGraph?.framework && input.frontendGraph.framework !== "none"
      ? input.frontendGraph.framework
      : undefined;
  const framework = frameworkFromFrontend === "next" ||
    frameworkFromFrontend === "nuxt" ||
    frameworkFromFrontend === "static" ||
    frameworkFromFrontend === "vite"
    ? frameworkFromFrontend
    : input.sources.some((source) => source.path.startsWith("web/app/"))
    ? "next"
    : input.sources.some((source) =>
        source.path === "web/vite.config.ts" ||
        source.path === "web/vite.config.js" ||
        source.path === "web/src/main.tsx" ||
        source.path === "web/src/main.jsx"
      )
      ? "vite"
      : "unknown";
  const manifest: UiTestManifest = {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    framework,
    webRoot,
    defaultBaseUrl: "http://127.0.0.1:3000",
    runtimeUrl: "http://127.0.0.1:3765",
    routes,
    scenarios: scenarios.map((scenario) => scenario.name),
    selectors: uniqueSorted(
      scenarios.flatMap((scenario) =>
        scenario.steps.flatMap((step) =>
          "selector" in step ? [step.selector] : [],
        ),
      ),
    ),
  };
  return {
    manifest,
    scenarios: { schemaVersion: "0.1.0", scenarios },
    routes: { schemaVersion: "0.1.0", routes },
  };
}

export function serializeUiTestManifestJson(manifest: UiTestManifest): string {
  return serializeCanonical(manifest);
}

export function serializeUiTestManifestTs(manifest: UiTestManifest): string {
  return `export const uiTestManifest = ${JSON.stringify(JSON.parse(serializeUiTestManifestJson(manifest)), null, 2)} as const;\n`;
}

export function serializeUiScenariosJson(scenarios: UiScenariosArtifact): string {
  return serializeCanonical(scenarios);
}

export function serializeUiScenariosTs(scenarios: UiScenariosArtifact): string {
  return `export const uiScenarios = ${JSON.stringify(JSON.parse(serializeUiScenariosJson(scenarios)), null, 2)} as const;\n`;
}

export function serializeUiRoutesJson(routes: UiRoutesArtifact): string {
  return serializeCanonical(routes);
}

export function serializeUiRoutesTs(routes: UiRoutesArtifact): string {
  return `export const uiRoutes = ${JSON.stringify(JSON.parse(serializeUiRoutesJson(routes)), null, 2)} as const;\n`;
}

export function validateUiScenario(scenario: UiScenario): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!scenario.name) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", "scenario name is required"));
  }
  if (!scenario.route.startsWith("/")) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", `scenario ${scenario.name} route must start with /`));
  }
  if (scenario.steps.length === 0) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", `scenario ${scenario.name} has no steps`));
  }
  for (const [index, step] of scenario.steps.entries()) {
    if ("selector" in step && !step.selector) {
      diagnostics.push(diagnostic("error", "FORGE_UI_SELECTOR_NOT_FOUND", `scenario ${scenario.name} step ${index + 1} selector is empty`));
    }
    if (step.kind === "goto" && !step.path.startsWith("/")) {
      diagnostics.push(diagnostic("error", "FORGE_UI_ROUTE_FAILED", `scenario ${scenario.name} goto path must start with /`));
    }
  }
  return diagnostics;
}

function loadUiManifest(workspaceRoot: string): UiTestManifest {
  return readJson<UiTestManifest>(workspaceRoot, `${GENERATED}/uiTestManifest.json`, {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    framework: "unknown",
    webRoot: "",
    defaultBaseUrl: "http://127.0.0.1:3000",
    runtimeUrl: "http://127.0.0.1:3765",
    routes: [{ path: "/", name: "home", uses: { commands: [], queries: [], liveQueries: [], components: [] } }],
    scenarios: ["home-loads"],
    selectors: ["body"],
  });
}

function loadUiScenarios(workspaceRoot: string): UiScenario[] {
  return readJson<UiScenariosArtifact>(workspaceRoot, `${GENERATED}/uiScenarios.json`, {
    schemaVersion: "0.1.0",
    scenarios: [{
      name: "home-loads",
      description: "Load the home route.",
      route: "/",
      cost: "browser",
      steps: [{ kind: "goto", path: "/" }, { kind: "expectVisible", selector: "body" }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }],
  }).scenarios;
}

function scenarioFailure(name: string, route: string, message: string, suggestedCommands?: string[]): UiScenarioResult {
  return {
    name,
    ok: false,
    route,
    durationMs: 0,
    steps: [],
    failure: {
      kind: "playwright-missing",
      message,
      suggestedCommands: suggestedCommands ?? [
        "bun add -d @playwright/test",
        "bunx playwright install",
        "forge ui doctor --json",
      ],
    },
  };
}

function suggestedCommands(results: UiScenarioResult[]): string[] {
  const commands = new Set<string>([
    "forge ui doctor --json",
    "forge review --changed",
  ]);
  for (const result of results) {
    if (result.failure?.kind === "live-query-no-update") {
      commands.add("forge live status --json");
      commands.add("forge live invalidations --json");
      commands.add("forge repair diagnose --from-last-ui-run --json");
    }
    if (result.traceId) {
      commands.add(`forge telemetry inspect ${result.traceId} --json`);
      commands.add(`forge repair diagnose --trace ${result.traceId} --json`);
    }
    for (const command of result.failure?.suggestedCommands ?? []) {
      commands.add(command);
    }
  }
  return [...commands].sort();
}

function makeRunId(input: unknown): string {
  return `ui_${hashStable(JSON.stringify(input)).slice(0, 12)}`;
}

function emptyReport(options: UiCommandOptions, scenarios: UiScenario[], diagnostics: Diagnostic[], started: number): UiRunReport {
  const context = uiPackageContext(options.workspaceRoot, loadUiManifest(options.workspaceRoot));
  const setupCommands = [
    `cd ${context.packageRootLabel}`,
    ...context.installCommands,
    "forge ui doctor --json",
  ];
  const results = scenarios.map((scenario) =>
    scenarioFailure(
      scenario.name,
      scenario.route,
      `Playwright is not available from ${context.packageRootLabel}; run forge ui doctor for setup details.`,
      setupCommands,
    ),
  );
  const failed = results.length;
  const report: UiRunReport = {
    schemaVersion: "0.1.0",
    uiRunVersion: UI_RUN_VERSION,
    id: makeRunId({ scenarios: scenarios.map((scenario) => scenario.name), diagnostics: diagnostics.map((item) => item.code) }),
    config: {
      baseUrl: options.baseUrl,
      runtimeUrl: options.runtimeUrl,
      browser: options.browser,
      headed: options.headed,
      trace: options.trace,
      screenshot: options.screenshot,
      video: options.video,
    },
    scenarios: results,
    summary: {
      ok: false,
      passed: 0,
      failed,
      skipped: 0,
      durationMs: Date.now() - started,
    },
    artifacts: {
      screenshots: [],
      traces: [],
      videos: [],
      logs: [],
      console: `${UI_RUN_DIR}/last/console.json`,
      network: `${UI_RUN_DIR}/last/network.json`,
    },
    suggestedCommands: [],
    diagnostics,
  };
  report.suggestedCommands = suggestedCommands(results);
  return report;
}

async function importPlaywright(workspaceRoot: string, manifest: UiTestManifest): Promise<unknown | null> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const context = uiPackageContext(workspaceRoot, manifest);
    const localCandidates = [
      join(context.packageRoot, "node_modules", "playwright", "index.js"),
      join(workspaceRoot, "node_modules", "playwright", "index.js"),
      join(context.packageRoot, "node_modules", "@playwright", "test", "index.js"),
      join(workspaceRoot, "node_modules", "@playwright", "test", "index.js"),
    ];
    for (const candidate of localCandidates) {
      if (!nodeFileSystem.exists(candidate)) {
        continue;
      }
      try {
        return await dynamicImport(pathToFileURL(candidate).href);
      } catch {
        // Try the next local package shape before falling back to normal resolution.
      }
    }
    return await dynamicImport("playwright");
  } catch {
    return null;
  }
}

async function runWithPlaywright(options: UiCommandOptions, scenarios: UiScenario[], started: number): Promise<UiRunReport> {
  const manifest = loadUiManifest(options.workspaceRoot);
  const context = uiPackageContext(options.workspaceRoot, manifest);
  const playwright = await importPlaywright(options.workspaceRoot, manifest) as Record<string, { launch: (options: { headless: boolean }) => Promise<unknown> }> | null;
  if (!playwright || !playwright[options.browser]) {
    const diag = createDiagnostic({
      severity: "error",
      code: "FORGE_UI_PLAYWRIGHT_MISSING",
      message: `Playwright is not available from ${context.packageRootLabel}; install @playwright/test and browser binaries before running UI scenarios.`,
      fixHint: `Run '${context.installDependencyCommand}' and '${context.installBrowsersCommand}' from ${context.packageRootLabel}.`,
      suggestedCommands: [
        `cd ${context.packageRootLabel}`,
        ...context.installCommands,
        "forge ui doctor --json",
      ],
    });
    return emptyReport(options, scenarios, [diag], started);
  }

  // The real adapter is intentionally small: declarative scenarios are executed
  // through Playwright when the package is available. Unit tests keep this path
  // behind optional dependency detection.
  const browser = await playwright[options.browser].launch({ headless: !options.headed }) as {
    newPage: () => Promise<{
      goto: (url: string, options?: { timeout?: number }) => Promise<unknown>;
      click: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
      fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
      selectOption: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
      waitForSelector: (selector: string, options?: { timeout?: number; state?: string }) => Promise<unknown>;
      textContent: (selector: string, options?: { timeout?: number }) => Promise<string | null>;
      screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  };
  const results: UiScenarioResult[] = [];
  const screenshots: string[] = [];
  for (const scenario of scenarios) {
    const scenarioStarted = Date.now();
    const steps: UiScenarioResult["steps"] = [];
    const page = await browser.newPage();
    let failed: UiScenarioResult["failure"];
    try {
      for (const step of scenario.steps) {
        const stepStarted = Date.now();
        await executeStep(page, options, step);
        steps.push({ kind: step.kind, ok: true, durationMs: Date.now() - stepStarted });
      }
    } catch (error) {
      const screenshot = `${UI_RUN_DIR}/${makeRunId(scenario.name)}/screenshots/failure-${scenario.name}.png`;
      const absolute = join(options.workspaceRoot, screenshot);
      nodeFileSystem.mkdirp(dirname(absolute));
      try {
        await page.screenshot({ path: absolute, fullPage: true });
        screenshots.push(screenshot);
      } catch {
        // Screenshot failures are surfaced by the main failure message.
      }
      failed = {
        kind: "expected-text-missing",
        message: error instanceof Error ? error.message : "UI scenario failed",
        screenshot,
        suggestedCommands: ["forge ui report last", "forge repair diagnose --from-last-ui-run --json"],
      };
    } finally {
      await page.close();
    }
    results.push({
      name: scenario.name,
      ok: !failed,
      route: scenario.route,
      durationMs: Date.now() - scenarioStarted,
      steps,
      failure: failed,
    });
  }
  await browser.close();
  return buildReportFromResults(options, results, [], screenshots, started);
}

async function executeStep(page: {
  goto: (url: string, options?: { timeout?: number }) => Promise<unknown>;
  click: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  selectOption: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number; state?: string }) => Promise<unknown>;
  textContent: (selector: string, options?: { timeout?: number }) => Promise<string | null>;
  screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
}, options: UiCommandOptions, step: UiScenarioStep): Promise<void> {
  if (step.kind === "goto") {
    await page.goto(new URL(step.path, options.baseUrl).toString(), { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "click") {
    await page.click(step.selector, { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "fill") {
    await page.fill(step.selector, step.value, { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "selectOption") {
    await page.selectOption(step.selector, step.value, { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "expectVisible") {
    await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs, state: "visible" });
    return;
  }
  if (step.kind === "expectNotVisible") {
    await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs, state: "hidden" });
    return;
  }
  if (step.kind === "expectText") {
    const text = await page.textContent(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs });
    if (!text?.includes(step.text)) {
      throw new Error(`Expected ${step.selector} to contain '${step.text}'`);
    }
    return;
  }
  if (step.kind === "captureScreenshot") {
    const path = `${UI_RUN_DIR}/snapshots/${step.name}.png`;
    const absolute = join(options.workspaceRoot, path);
    nodeFileSystem.mkdirp(dirname(absolute));
    await page.screenshot({ path: absolute, fullPage: true });
  }
}

function buildReportFromResults(
  options: UiCommandOptions,
  results: UiScenarioResult[],
  diagnostics: Diagnostic[],
  screenshots: string[],
  started: number,
): UiRunReport {
  const failed = results.filter((result) => !result.ok).length;
  const passed = results.filter((result) => result.ok).length;
  const report: UiRunReport = {
    schemaVersion: "0.1.0",
    uiRunVersion: UI_RUN_VERSION,
    id: makeRunId({ scenarios: results.map((result) => result.name), failed, passed }),
    config: {
      baseUrl: options.baseUrl,
      runtimeUrl: options.runtimeUrl,
      browser: options.browser,
      headed: options.headed,
      trace: options.trace,
      screenshot: options.screenshot,
      video: options.video,
    },
    scenarios: results,
    summary: {
      ok: failed === 0 && diagnostics.every((item) => item.severity !== "error"),
      passed,
      failed,
      skipped: 0,
      durationMs: Date.now() - started,
    },
    artifacts: {
      screenshots,
      traces: [],
      videos: [],
      logs: [],
      console: `${UI_RUN_DIR}/last/console.json`,
      network: `${UI_RUN_DIR}/last/network.json`,
    },
    suggestedCommands: suggestedCommands(results),
    diagnostics,
  };
  return report;
}

function renderReportMarkdown(report: UiRunReport): string {
  return `# Forge UI Run

Run: ${report.id}
OK: ${report.summary.ok ? "yes" : "no"}
Passed: ${report.summary.passed}
Failed: ${report.summary.failed}

## Scenarios

${report.scenarios.map((scenario) => `- ${scenario.ok ? "OK" : "FAIL"} ${scenario.name}${scenario.failure ? `: ${scenario.failure.message}` : ""}`).join("\n") || "- none"}

## Suggested Commands

\`\`\`bash
${report.suggestedCommands.join("\n")}
\`\`\`
`;
}

export function writeUiReport(workspaceRoot: string, report: UiRunReport): void {
  const dir = `${UI_RUN_DIR}/${report.id}`;
  writeText(workspaceRoot, `${dir}/report.json`, serializeCanonical(report));
  writeText(workspaceRoot, `${dir}/report.md`, renderReportMarkdown(report));
  writeText(workspaceRoot, `${dir}/console.json`, "[]\n");
  writeText(workspaceRoot, `${dir}/network.json`, "[]\n");
  writeText(workspaceRoot, `${UI_RUN_DIR}/last.json`, serializeCanonical(report));
}

function selectScenarios(options: UiCommandOptions, scenarios: UiScenario[]): UiScenario[] {
  if (options.subcommand === "route") {
    const path = options.routePath ?? "/";
    return [{
      name: `route-${routeName(path)}`,
      description: `Load route ${path}`,
      route: path,
      cost: "browser",
      steps: [{ kind: "goto", path }, { kind: "expectVisible", selector: "body" }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }];
  }
  if (options.subcommand === "snapshot") {
    const path = options.routePath ?? "/";
    return [{
      name: options.snapshotName ?? `snapshot-${routeName(path)}`,
      description: `Capture snapshot for ${path}`,
      route: path,
      cost: "browser",
      steps: [{ kind: "goto", path }, { kind: "captureScreenshot", name: options.snapshotName ?? routeName(path) }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }];
  }
  if (options.scenarioName) {
    return scenarios.filter((scenario) => scenario.name === options.scenarioName);
  }
  if (options.subcommand === "smoke") {
    return scenarios.filter((scenario) => scenario.cost === "browser").slice(0, 4);
  }
  return options.all ? scenarios : scenarios.slice(0, 1);
}

export async function runUiCommand(options: UiCommandOptions): Promise<UiCommandResult> {
  if (options.subcommand === "audit") {
    return runUiAudit(options);
  }
  if (options.subcommand === "doctor") {
    return runUiDoctor(options);
  }
  if (options.subcommand === "list") {
    const scenarios = loadUiScenarios(options.workspaceRoot);
    return { ok: true, manifest: loadUiManifest(options.workspaceRoot), scenarios, diagnostics: [], exitCode: 0 };
  }
  if (options.subcommand === "report") {
    return readUiReport(options.workspaceRoot, options.reportId ?? "last");
  }

  const started = Date.now();
  const allScenarios = loadUiScenarios(options.workspaceRoot);
  const selected = selectScenarios(options, allScenarios);
  const validation = selected.flatMap(validateUiScenario);
  if (validation.some((item) => item.severity === "error")) {
    const report = emptyReport(options, selected, validation, started);
    writeUiReport(options.workspaceRoot, report);
    return { ok: false, report, diagnostics: validation, exitCode: 1 };
  }
  const report = await runWithPlaywright(options, selected, started);
  writeUiReport(options.workspaceRoot, report);
  return {
    ok: report.summary.ok,
    report,
    diagnostics: report.diagnostics,
    exitCode: report.summary.ok ? 0 : 1,
  };
}

function runUiAudit(options: UiCommandOptions): UiCommandResult {
  const manifest = loadUiManifest(options.workspaceRoot);
  const scenarios = loadUiScenarios(options.workspaceRoot);
  const diagnostics: Diagnostic[] = [];
  const webSources = listWebSourceFiles(options.workspaceRoot, manifest.webRoot);
  const webImplementationSources = listWebImplementationFiles(options.workspaceRoot, manifest.webRoot);
  const webText = webSources.map((source) => source.text).join("\n");
  const webImplementationText = webImplementationSources.map((source) => source.text).join("\n");
  const appShellText = webSources
    .filter((source) => !source.path.endsWith("/lib/workos-auth.tsx"))
    .map((source) => source.text)
    .join("\n");
  const scenarioRoutes = new Set(scenarios.map((scenario) => scenario.route));
  const scenarioNames = scenarios.map((scenario) => scenario.name);
  const runtimeCommandNames = uniqueSorted([
    ...manifest.routes.flatMap((route) => route.uses.commands),
    ...scenarios.flatMap((scenario) => scenario.requires.commands),
  ]);
  const selectorSet = new Set(manifest.selectors);

  if (manifest.routes.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", "No frontend routes are present in uiTestManifest."));
  }
  if (manifest.routes.length > 0 && scenarios.length === 0) {
    diagnostics.push(diagnostic("error", "FORGE_UI_TESTID_MISSING", "Frontend routes exist but no UI scenarios were generated."));
  }
  for (const route of manifest.routes) {
    if (!scenarioRoutes.has(route.path)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", `No UI scenario covers route '${route.path}'.`));
    }
    const usesRuntime = route.uses.commands.length > 0 || route.uses.queries.length > 0 || route.uses.liveQueries.length > 0;
    if (usesRuntime && selectorSet.size === 0) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", `Route '${route.path}' uses Forge runtime bindings but no stable data-forge-testid selectors were detected.`));
    }
  }
  const hasPolicySensitiveRuntime = scenarios.some((scenario) =>
    scenario.requires.policies.length > 0 || scenario.requires.commands.length > 0
  );
  if (
    hasPolicySensitiveRuntime &&
    !scenarioNames.some((name) => name.includes("policy-denied")) &&
    !/data-forge-testid=["'][^"']*policy-denied/i.test(webText)
  ) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_POLICY_ERROR_MISSING", "Policy-sensitive UI flows should include a visible policy-denied scenario."));
  }
  if (manifest.routes.length > 0 && !manifest.selectors.some((selector) => selector.includes("data-forge-testid"))) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", "No data-forge-testid selectors were captured for UI smoke/audit stability."));
  }
  if (manifest.webRoot && manifest.routes.length > 0 && webSources.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_SOURCE_MISSING", `No frontend source files were found under '${manifest.webRoot}' for static UX audit.`));
  }
  if (manifest.framework === "vite" && manifest.webRoot) {
    const absoluteBridge = viteBridgeUsesLocalAbsoluteUrl(options.workspaceRoot, manifest.webRoot);
    if (absoluteBridge && !viteUsesSameOriginProxy(options.workspaceRoot, manifest.webRoot)) {
      diagnostics.push(createDiagnostic({
        severity: "warning",
        code: "FORGE_UI_LOCAL_API_FORWARDING_RISK",
        message: "Vite frontend bridge points at http://127.0.0.1:3765 without a same-origin proxy; forwarded browsers can fail with 'Failed to fetch'.",
        file: absoluteBridge,
        fixHint: "Use a same-origin Forge bridge in dev and add a Vite proxy for /commands, /queries, /live, /health, /auth.md, and /.well-known.",
        suggestedCommands: ["forge make ui --framework vite --dry-run --json", "forge inspect ui --ergonomics --json"],
      }));
    }
  }
  if (webSources.length > 0 && !webSources.some((source) => hasMainLandmark(source.text))) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_LANDMARK_MISSING", "Frontend source does not appear to include a main/header/nav landmark; add semantic landmarks for scanning and accessibility."));
  }
  if (hasProductDemoCopy(stripCollapsibleDetails(appShellText))) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_PRODUCT_COPY_TOO_META",
      "The primary product UI appears to explain ForgeOS or the demo instead of presenting the user workflow; move framework details into a collapsible dev panel or docs.",
    ));
  }
  const primaryShellText = stripCollapsibleDetails(appShellText);
  if (hasDemoAuthCopy(primaryShellText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_AUTH_COPY_TOO_DEMO",
      "The primary auth UI uses demo-login language; label local identities as local/dev mode and reserve demo details for a collapsible diagnostics panel.",
    ));
  }
  if (hasFakeCredentialAuthForm(primaryShellText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_FAKE_AUTH_FORM",
      "The UI appears to show a password-style login without a real auth provider; use AuthKit/OIDC/JWT for production auth or a clearly labeled local identity selector for dev.",
    ));
  }
  if (hasExposedDevDiagnostics(primaryShellText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_DEV_DIAGNOSTICS_EXPOSED",
      "Operational Forge/WorkOS diagnostics appear in the primary product surface; move env, seed, claims, capability, and policy-proof details into a collapsible developer panel.",
    ));
  }
  if (runtimeCommandNames.length > 0 && webSources.length > 0 && !hasPrimaryWorkflowAction(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_PRIMARY_ACTION_MISSING",
      "Runtime commands exist but the UI has no obvious primary action; expose the main create/update/approve/request flow as a real form or button.",
    ));
  }
  if (manifest.routes.length > 0 && webSources.length > 0 && !hasWorkflowNavigation(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_WORKFLOW_NAV_MISSING",
      "The UI has routes but no obvious workflow navigation or section anchors; add nav/section structure so users can scan repeated workflows.",
    ));
  }
  if (!hasNetworkRecoveryHint(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_NETWORK_ERROR_TOO_GENERIC",
      "Frontend handles a network/runtime fetch error but does not tell the user how to recover; mention /health, npm run dev, the Vite proxy, CORS, or the runtime URL.",
    ));
  }
  const seedCommandNames = runtimeCommandNames.filter((name) => /seed/i.test(name));
  const hasDemoSeedCommand = seedCommandNames.some((name) => /demo|sample|fixture|vendorAccess/i.test(name));
  if (seedCommandNames.length > 0 && !hasSeedExperience(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_SEED_ACTION_MISSING",
      "A seed command exists but the UI has no visible seed/reset/status experience; first-run apps should not look empty or broken.",
    ));
  }
  if (hasDemoSeedCommand && webSources.length > 0 && !hasAutomaticSeedRecovery(webImplementationText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_AUTO_SEED_RECOVERY_MISSING",
      "A demo/sample seed command exists, but the UI does not appear to auto-recover an empty first-run workspace; seed automatically on empty data or make npm run dev use forge dev --seed.",
    ));
  }
  for (const source of webSources) {
    if (findFormWithoutLabel(source.text)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_FORM_LABEL_MISSING", "Form controls should have labels or aria-label/aria-labelledby for accessible testing and real users.", source.path));
    }
    if (findUnnamedButton(source.text)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_BUTTON_NAME_MISSING", "Icon-only or empty buttons should include aria-label/title text.", source.path));
    }
  }
  if (webSources.some((source) => hasRuntimeDataHook(source.text))) {
    if (!hasStateText(webText, /\b(isLoading|loading|pending|skeleton|spinner|carregando|loading\.\.\.)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_LOADING_STATE_MISSING", "Forge data-bound UI should expose a loading or pending state."));
    }
    if (!hasStateText(webText, /\b(error|erro|failed|failure|FORGE_|traceId|trace)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_ERROR_STATE_MISSING", "Forge data-bound UI should surface runtime/policy errors with enough context to debug."));
    }
    if (!hasStateText(webText, /\b(empty|no\s+\w+|none|vazio|sem\s+\w+|length\s*===\s*0)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_EMPTY_STATE_MISSING", "Forge data-bound UI should include an empty state so first-run apps do not look broken."));
    }
  }
  if ((hasTenantScopedData(options.workspaceRoot) || hasProductionAuthMode(options.workspaceRoot)) && webSources.length > 0 && !looksLikeAuthFlow(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_AUTH_FLOW_MISSING",
      "Tenant-scoped or production-auth app has no obvious sign-in/session/organization UI; local devAuth is not a production auth flow.",
    ));
  }
  if (hasPolicySensitiveRuntime && webSources.length > 0 && !hasPermissionFeedback(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_PERMISSION_FEEDBACK_MISSING",
      "Policy-sensitive UI has no obvious permission-aware disabled state, denial copy, or forbidden-state feedback.",
    ));
  }
  if (
    hasWorkOSIntegration(options.workspaceRoot) &&
    manifest.webRoot &&
    webSources.length > 0 &&
    !hasVisibleWorkOSAuthControl(primaryShellText)
  ) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_WORKOS_AUTH_FLOW_MISSING",
      "WorkOS integration is present, but the primary UI has no visible WorkOS/AuthKit sign-in/sign-out or /login-/logout-linked control; expose the AuthKit entry and exit path instead of relying on hidden session state.",
    ));
  }
  if (
    (hasWorkOSIntegration(options.workspaceRoot) || hasProductionAuthMode(options.workspaceRoot)) &&
    manifest.webRoot &&
    webSources.length > 0 &&
    hasLocalIdentityControl(primaryShellText) &&
    !hasLocalAuthBoundaryCopy(primaryShellText)
  ) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_LOCAL_AUTH_BOUNDARY_MISSING",
      "The primary UI exposes local persona/dev-auth controls while production auth is configured; label them as local/dev mode or hide them behind a developer panel so users do not mistake them for real auth.",
    ));
  }
  if (
    hasWorkOSIntegration(options.workspaceRoot) &&
    manifest.webRoot &&
    webSources.length > 0 &&
    (!webPackageHasAuthKit(options.workspaceRoot) ||
      (!/AuthKitProvider/.test(appShellText) && !/ForgeWorkOSAuthProvider/.test(appShellText)) ||
      (!/getToken/.test(webImplementationText) && !/getAccessToken/.test(webImplementationText)))
  ) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_WORKOS_AUTHKIT_MISSING",
      "WorkOS integration is present, but the web app does not appear to mount AuthKitProvider or pass a WorkOS token provider into ForgeProvider.",
    ));
  }
  if (
    hasWorkOSIntegration(options.workspaceRoot) &&
    manifest.webRoot &&
    webSources.length > 0 &&
    webPackageHasAuthKit(options.workspaceRoot) &&
    (/AuthKitProvider/.test(appShellText) || /ForgeWorkOSAuthProvider/.test(appShellText)) &&
    (/getToken/.test(webImplementationText) || /getAccessToken/.test(webImplementationText)) &&
    (!webUsesWorkOSSessionClaims(webImplementationText) || !webConfigProxiesWorkOSSession(options.workspaceRoot, manifest.webRoot))
  ) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_WORKOS_SESSION_MISSING",
      "WorkOS integration is present, but the frontend does not appear to expose normalized /session claims or proxy the AuthKit session routes; add useForgeWorkOSSession and proxy /login, /callback, /logout, and /session.",
    ));
  }

  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    manifest,
    scenarios,
    diagnostics,
    exitCode: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}

function runUiDoctor(options: UiCommandOptions): UiCommandResult {
  const manifest = loadUiManifest(options.workspaceRoot);
  const diagnostics: Diagnostic[] = [];
  const packageContext = uiPackageContext(options.workspaceRoot, manifest);
  if (!packageContext.hasPackageJson) {
    diagnostics.push(createDiagnostic({
      severity: "warning",
      code: "FORGE_UI_PACKAGE_ROOT_MISSING",
      message: `No package.json found for UI package root ${packageContext.packageRootLabel}; UI smoke setup cannot infer install commands precisely.`,
      fixHint: "Run from the app root or add a web/package.json before installing Playwright.",
      suggestedCommands: ["forge inspect frontend --json", "forge ui doctor --json"],
    }));
  }
  if (!packageContext.playwrightInstalled) {
    diagnostics.push(createDiagnostic({
      severity: "error",
      code: "FORGE_UI_PLAYWRIGHT_MISSING",
      message: packageContext.hasPlaywrightDependency
        ? `Playwright is declared but node_modules is missing under ${packageContext.packageRootLabel}; install dependencies and browser binaries before running UI scenarios.`
        : `Playwright is not installed for UI package root ${packageContext.packageRootLabel}.`,
      fixHint: packageContext.hasPlaywrightDependency
        ? `Run your package install, then '${packageContext.installBrowsersCommand}'.`
        : `Run '${packageContext.installDependencyCommand}' and '${packageContext.installBrowsersCommand}'.`,
      suggestedCommands: packageContext.hasPlaywrightDependency
        ? [
            `cd ${packageContext.packageRootLabel}`,
            packageContext.packageManager === "npm" ? "npm install" : `${packageContext.packageManager} install`,
            packageContext.installBrowsersCommand,
          ]
        : [
            `cd ${packageContext.packageRootLabel}`,
            ...packageContext.installCommands,
          ],
    }));
  }
  if (manifest.routes.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", "No UI routes are present in uiTestManifest."));
  }
  if (manifest.scenarios.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", "No UI scenarios are present in uiScenarios."));
  }
  if (manifest.routes.length > 0 && manifest.selectors.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", "No stable selectors are present in uiTestManifest; browser failures will be harder to repair."));
  }
  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    manifest,
    diagnostics,
    exitCode: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}

function readUiReport(workspaceRoot: string, id: string): UiCommandResult {
  const path =
    id === "last"
      ? `${UI_RUN_DIR}/last.json`
      : `${UI_RUN_DIR}/${id}/report.json`;
  const absolute = join(workspaceRoot, path);
  if (!nodeFileSystem.exists(absolute)) {
    const diag = diagnostic("error", "FORGE_UI_REPORT_NOT_FOUND", `UI report not found: ${id}`, path);
    return { ok: false, diagnostics: [diag], exitCode: 1 };
  }
  const report = JSON.parse((nodeFileSystem.readText(absolute) ?? "")) as UiRunReport;
  return { ok: report.summary.ok, report, diagnostics: report.diagnostics, exitCode: report.summary.ok ? 0 : 1 };
}

export function listUiRuns(workspaceRoot: string): Array<{ id: string; path: string }> {
  const dir = join(workspaceRoot, UI_RUN_DIR);
  if (!nodeFileSystem.exists(dir)) return [];
  return nodeFileSystem
    .readDir(dir)
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({ id: entry.name, path: `${UI_RUN_DIR}/${entry.name}/report.json` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function formatUiJson(result: UiCommandResult): string {
  if (result.report) {
    return `${JSON.stringify(result.report, null, 2)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatUiHuman(result: UiCommandResult): string {
  if (result.report) {
    return renderReportMarkdown(result.report);
  }
  if (result.scenarios) {
    return `Forge UI Scenarios

${result.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.route}`).join("\n")}
`;
  }
  if (result.manifest) {
    return `Forge UI Doctor

${result.diagnostics.map((diag) => `${diag.severity} ${diag.code}: ${diag.message}`).join("\n") || "OK"}
`;
  }
  return `${result.diagnostics.map((diag) => `${diag.severity} ${diag.code}: ${diag.message}`).join("\n")}\n`;
}

export function runUiListCommand(workspaceRoot: string): UiCommandResult {
  return {
    ok: true,
    reports: listUiRuns(workspaceRoot),
    diagnostics: [],
    exitCode: 0,
  };
}

export function runForgeCommandForUi(workspaceRoot: string, command: string): { ok: boolean; output: string } {
  const parts = command.split(/\s+/).filter(Boolean);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
