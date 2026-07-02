import { join, relative, resolve } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { AddOptions } from "../types/cli.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { Dependency } from "../types/package-graph.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildAppGraph } from "../app-graph/build.ts";
import { classify } from "../classifier/classify.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { emit } from "../emitter/emit.ts";
import {
  FORGE_LOCK_SCHEMA_VERSION,
  GENERATOR_VERSION,
} from "../emitter/constants.ts";
import { PACKAGE_ANALYZER_VERSION } from "../package-graph/constants.ts";
import { renderBody } from "../emitter/render.ts";
import { hashStable } from "../primitives/hash.ts";
import { PackageGraphCompiler } from "../package-graph/compiler.ts";
import { run as runGenerate } from "../orchestrator/run.ts";
import {
  buildAddCommand,
  detectAndCreatePackageManagerAdapter,
  dryRunRecipeFallbackMessage,
  type PackageManagerAdapter,
} from "../package-manager/adapter.ts";
import { parsePackageName } from "../package-manager/parse-spec.ts";
import { PackageManagerCommandError } from "../package-manager/executor.ts";
import {
  isReferenceAlias,
  resolveByPackageName,
  resolveRecipe,
} from "../recipes/registry.ts";
import { discover } from "../orchestrator/discover.ts";
import {
  loadManifest,
  saveManifest,
  updateManifestAfterWrite,
} from "../orchestrator/manifest.ts";
import { verifyLockIntegrity } from "../orchestrator/verify.ts";
import {
  buildIntegrationEmitPlan,
  loadExistingForgeLock,
} from "./plan.ts";
import {
  restoreVersionControlledSnapshot,
  snapshotVersionControlled,
} from "./snapshot.ts";

export interface ForgeAddOptions extends AddOptions {
  workspaceRoot: string;
  pmAdapter?: PackageManagerAdapter;
}

export interface ForgeAddResult {
  alias: string;
  mode?: "integration" | "package";
  targetKind?: "forge-integration" | "npm-package";
  target?: string;
  packageTarget?: "root" | "frontend" | "backend" | "workspace";
  packageTargetReason?: string;
  explanation?: string;
  recipeVersion?: string;
  recipePackages?: string[];
  requiredSecrets?: string[];
  optionalSecrets?: string[];
  packageSpec?: string;
  packageName?: string;
  packageManager?: string;
  installCommand?: string[];
  nativeInstallCommand?: string[];
  avoidedManualCommand?: string;
  installCwd?: string;
  installWorkspace?: string;
  changed: string[];
  unchanged: string[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  exitCode: 0 | 1;
  failureKind?: string;
}

function recipeResultMetadata(recipe: IntegrationRecipe): Pick<
  ForgeAddResult,
  "recipeVersion" | "recipePackages" | "requiredSecrets" | "optionalSecrets"
> {
  return {
    recipeVersion: recipe.recipeVersion,
    recipePackages: recipe.packages.map((pkg) => pkg.packageName),
    requiredSecrets: recipe.secrets.filter((secret) => secret.required !== false).map((secret) => secret.envVar),
    optionalSecrets: recipe.secrets.filter((secret) => secret.required === false).map((secret) => secret.envVar),
  };
}

const WORKOS_FGA_INTEGRATION_FILES = new Set([
  "workos/fga.ts",
  "workos/resource-map.ts",
]);

function applyWorkOSRecipeProfile(
  recipe: NonNullable<ReturnType<typeof resolveRecipe>>,
  options: Pick<ForgeAddOptions, "withFga">,
): IntegrationRecipe {
  if (recipe.alias !== "workos" || options.withFga) {
    return recipe;
  }
  return {
    ...recipe,
    integrations: recipe.integrations?.filter((file) => !WORKOS_FGA_INTEGRATION_FILES.has(file)),
  };
}

function addExplanation(result: ForgeAddResult): string {
  if (result.mode === "package") {
    const location = result.target && result.target !== "root" ? `${result.target}/package.json` : "package.json";
    const command = result.installCommand?.join(" ") ?? `package manager add ${result.packageSpec ?? result.alias}`;
    const target = result.packageTarget && result.packageTarget !== "root" ? ` (${result.packageTarget})` : "";
    return `Adds npm package '${result.packageSpec ?? result.alias}' to ${location}${target}, then refreshes Forge package evidence. Forge runs the native install command for you: ${command}.`;
  }

  if (result.failureKind === "unknown_alias") {
    return `No Forge integration recipe exists for '${result.alias}'. Use 'forge add ${result.alias}' or 'forge add package ${result.alias}' for a normal npm package, or choose a supported integration alias.`;
  }

  return `Applies the Forge integration recipe '${result.alias}', including package install, generated adapters, secret-name metadata, runtime guards, and Forge lock evidence.`;
}

function finalizeAddResult(result: Omit<ForgeAddResult, "targetKind" | "explanation">): ForgeAddResult {
  const mode = result.mode ?? "integration";
  const withMode: ForgeAddResult = {
    ...result,
    mode,
    targetKind: mode === "package" ? "npm-package" : "forge-integration",
  };
  return {
    ...withMode,
    explanation: addExplanation(withMode),
  };
}

function packageJsonRelativeFor(workspace?: string): string {
  return workspace ? `${workspace.replace(/\\/g, "/")}/package.json` : "package.json";
}

function readPackageJsonDependencies(packageJsonPath: string): Record<string, string> {
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    return {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
      ...(parsed.peerDependencies ?? {}),
      ...(parsed.optionalDependencies ?? {}),
    };
  } catch {
    return {};
  }
}

function packageJsonDeclares(packageJsonPath: string, packageName: string): boolean {
  return Object.prototype.hasOwnProperty.call(readPackageJsonDependencies(packageJsonPath), packageName);
}

function packageInstallEvidence(installRoot: string, packageName: string): {
  installPath: string;
  version: string;
} | null {
  const installPath = join(installRoot, "node_modules", ...packageName.split("/"));
  const packageJsonPath = join(installPath, "package.json");
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
      version?: unknown;
    };
    return {
      installPath,
      version: typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : "0.0.0",
    };
  } catch {
    return {
      installPath,
      version: "0.0.0",
    };
  }
}

function dependencyRangeFromInstalledVersion(version: string): string {
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return `^${version}`;
  }
  return version && version !== "0.0.0" ? version : "*";
}

function ensurePackageJsonDependency(packageJsonPath: string, packageName: string, version: string): boolean {
  if (!nodeFileSystem.exists(packageJsonPath) || packageJsonDeclares(packageJsonPath, packageName)) {
    return false;
  }
  const parsed = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
    dependencies?: Record<string, string>;
  };
  parsed.dependencies = {
    ...(parsed.dependencies ?? {}),
    [packageName]: dependencyRangeFromInstalledVersion(version),
  };
  parsed.dependencies = Object.fromEntries(
    Object.entries(parsed.dependencies).sort(([left], [right]) => left.localeCompare(right)),
  );
  nodeFileSystem.writeText(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

async function addPackageOrContinueIfInstalled(input: {
  pm: PackageManagerAdapter;
  packageName: string;
  workspaceRoot: string;
  installRoot: string;
  packageJsonPath: string;
  ignoreScripts: boolean;
  warnings: Diagnostic[];
  doctorCommand: string;
  allowInstalledFallback: boolean;
}): Promise<void> {
  if (packageJsonDeclares(input.packageJsonPath, input.packageName)) {
    input.warnings.push(
      createDiagnostic({
        severity: "warning",
        code: "FORGE_ADD_PACKAGE_ALREADY_DECLARED",
        message: `${input.packageName} is already declared in ${relative(input.workspaceRoot, input.packageJsonPath).replace(/\\/g, "/")}; skipped package-manager install and continued recipe generation.`,
        fixHint: `Run your package manager install if node_modules is missing, then rerun ${input.doctorCommand}.`,
        suggestedCommands: [input.doctorCommand],
      }),
    );
    return;
  }

  try {
    await input.pm.add(input.packageName, {
      cwd: input.installRoot,
      ignoreScripts: input.ignoreScripts,
    });
    return;
  } catch (error) {
    if (!input.allowInstalledFallback) {
      throw error;
    }
    const evidence = packageInstallEvidence(input.installRoot, input.packageName);
    if (!evidence) {
      throw error;
    }
    const declared = ensurePackageJsonDependency(input.packageJsonPath, input.packageName, evidence.version);
    input.warnings.push(
      createDiagnostic({
        severity: "warning",
        code: "FORGE_ADD_PACKAGE_ALREADY_INSTALLED",
        message: `package-manager install for ${input.packageName} failed, but the package is already installed at ${relative(input.workspaceRoot, evidence.installPath).replace(/\\/g, "/")}; ${declared ? "recorded it in package.json and continued" : "continued recipe generation"}.`,
        fixHint: `Rerun ${input.doctorCommand}; if node_modules was restored from cache, this is expected.`,
        suggestedCommands: [input.doctorCommand],
      }),
    );
  }
}

type PackageAddScope = "root" | "frontend" | "backend" | "workspace";

interface NormalizedPackageRequest {
  spec: string;
  packageTarget: PackageAddScope;
  packageTargetReason: string;
  installWorkspace?: string;
  forcePackageMode: boolean;
}

function parseScopedPackageSpec(spec: string): {
  spec: string;
  target?: "frontend" | "backend";
  forcePackageMode: boolean;
} {
  const trimmed = spec.trim();
  const match = /^(frontend|front|web|client|backend|back|server|api|root):(.+)$/i.exec(trimmed);
  if (!match) {
    return { spec: trimmed, forcePackageMode: false };
  }
  const scope = match[1]!.toLowerCase();
  return {
    spec: match[2]!.trim(),
    target: scope === "frontend" || scope === "front" || scope === "web" || scope === "client"
      ? "frontend"
      : "backend",
    forcePackageMode: true,
  };
}

function findFrontendWorkspace(workspaceRoot: string): string | undefined {
  for (const candidate of ["web", "frontend", "client", "apps/web", "packages/web"]) {
    if (nodeFileSystem.exists(join(workspaceRoot, candidate, "package.json"))) {
      return candidate;
    }
  }
  return undefined;
}

function normalizePackageRequest(
  spec: string,
  options: ForgeAddOptions,
): { request: NormalizedPackageRequest; error?: Diagnostic } {
  const scoped = parseScopedPackageSpec(spec);
  const requestedTarget = options.packageTarget ?? scoped.target;
  if (options.installWorkspace?.trim()) {
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "workspace",
        packageTargetReason: `explicit --workspace ${options.installWorkspace.trim()}`,
        installWorkspace: options.installWorkspace.trim(),
        forcePackageMode: scoped.forcePackageMode,
      },
    };
  }
  if (requestedTarget === "frontend") {
    const workspace = findFrontendWorkspace(options.workspaceRoot);
    if (!workspace) {
      return {
        request: {
          spec: scoped.spec,
          packageTarget: "frontend",
          packageTargetReason: "frontend target requested, but no frontend package.json was detected",
          forcePackageMode: true,
        },
        error: createDiagnostic({
          severity: "error",
          code: "FORGE_ADD_FRONTEND_WORKSPACE_MISSING",
          message: "frontend package target requested, but no frontend package.json was found under web, frontend, client, apps/web, or packages/web",
          fixHint: "Create a frontend with forge make ui, pass --workspace <path>, or install as a backend/root package.",
          suggestedCommands: [
            "forge make ui --framework vite --dry-run --json",
            `forge add ${scoped.spec} --workspace web --dry-run --json`,
            `forge add backend:${scoped.spec} --dry-run --json`,
          ],
        }),
      };
    }
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "frontend",
        packageTargetReason: `frontend target resolved to ${workspace}/package.json`,
        installWorkspace: workspace,
        forcePackageMode: true,
      },
    };
  }
  if (requestedTarget === "backend") {
    return {
      request: {
        spec: scoped.spec,
        packageTarget: "backend",
        packageTargetReason: "backend target resolves to the Forge app root package.json",
        forcePackageMode: true,
      },
    };
  }
  return {
    request: {
      spec: scoped.spec,
      packageTarget: "root",
      packageTargetReason: "default package target resolves to the Forge app root package.json",
      forcePackageMode: scoped.forcePackageMode,
    },
  };
}

function resolveInstallRoot(options: ForgeAddOptions): {
  installRoot: string;
  target: string;
  extraSnapshotPaths: string[];
  error?: Diagnostic;
} {
  const workspace = options.installWorkspace?.trim();
  if (!workspace) {
    return {
      installRoot: options.workspaceRoot,
      target: "root",
      extraSnapshotPaths: [],
    };
  }

  const workspaceRoot = resolve(options.workspaceRoot);
  const installRoot = resolve(workspaceRoot, workspace);
  const rel = relative(workspaceRoot, installRoot).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel === "") {
    return {
      installRoot,
      target: workspace,
      extraSnapshotPaths: [],
      error: createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INVALID_WORKSPACE",
        message: `workspace '${workspace}' must resolve inside the Forge app`,
      }),
    };
  }

  if (!nodeFileSystem.exists(join(installRoot, "package.json"))) {
    return {
      installRoot,
      target: rel,
      extraSnapshotPaths: [],
      error: createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INVALID_WORKSPACE",
        message: `workspace '${workspace}' does not contain a package.json`,
      }),
    };
  }

  return {
    installRoot,
    target: rel,
    extraSnapshotPaths: [packageJsonRelativeFor(rel)],
  };
}

function failureKind(errors: Diagnostic[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  const first = errors[0];
  if (first?.code === "FORGE_UNKNOWN_ALIAS") {
    return "unknown_alias";
  }
  if (first?.code === "FORGE_ADD_INSTALL_FAILED") {
    return "install_failed";
  }
  if (errors.some((error) => error.code === "FORGE_WRITE_ERROR")) {
    return "write_failed";
  }
  if (errors.some((error) => error.code === "FORGE_LOCK_INTEGRITY")) {
    return "lock_integrity";
  }
  return "error";
}

function collectAllClassified(
  ctx: ReturnType<typeof discover>,
  cacheDir: string,
  runtimeInspect: boolean,
  sandboxBackend: ForgeAddOptions["sandboxBackend"],
): Promise<ClassifiedPackage[]> {
  const compiler = new PackageGraphCompiler();
  return Promise.all(
    ctx.dependencies.map(async (dep) => {
      const recipe = resolveByPackageName(dep.name) ?? undefined;
      const api = await compiler.analyze(dep, {
        runtimeInspect,
        sandboxBackend,
        resolutionMode: "nodenext",
        cacheDir,
        recipeVersion: recipe?.recipeVersion,
      });
      return {
        api,
        classification: classify(api, recipe),
        recipe,
      };
    }),
  );
}

function dependencyFromInstall(
  packageName: string,
  version: string,
  workspaceRoot: string,
  packageManager: Dependency["packageManager"],
  installRoot = workspaceRoot,
): Dependency {
  return {
    name: packageName,
    version,
    packageManager,
    installPath: join(installRoot, "node_modules", ...packageName.split("/")),
  };
}

function fileHashOrNull(path: string): string | null {
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  return hashStable(nodeFileSystem.readText(path) ?? "");
}

function snapshotPackageManagerFiles(
  workspaceRoot: string,
  pm: PackageManagerAdapter,
  extraPaths: string[] = [],
): Map<string, string | null> {
  const paths = [...new Set(["package.json", pm.lockfile, ...extraPaths])];
  return new Map(
    paths.map((path) => [
      path,
      fileHashOrNull(join(workspaceRoot, path)),
    ]),
  );
}

function changedPackageManagerFiles(
  workspaceRoot: string,
  before: Map<string, string | null>,
): string[] {
  const changed: string[] = [];
  for (const [path, previousHash] of before) {
    if (fileHashOrNull(join(workspaceRoot, path)) !== previousHash) {
      changed.push(path);
    }
  }
  return changed.sort();
}

function workosFrontendWorkspace(workspaceRoot: string): string | undefined {
  return findFrontendWorkspace(workspaceRoot);
}

function connectWorkOSReactRoot(workspaceRoot: string, frontendWorkspace: string): {
  changed: string[];
  warnings: Diagnostic[];
} {
  const mainRel = `${frontendWorkspace}/src/main.tsx`;
  const mainPath = join(workspaceRoot, mainRel);
  const current = nodeFileSystem.readText(mainPath);
  if (current === null) {
    return {
      changed: [],
      warnings: [
        createDiagnostic({
          severity: "warning",
          code: "FORGE_WORKOS_AUTHKIT_ROOT_NOT_FOUND",
          message: `generated WorkOS AuthKit bridge, but ${mainRel} was not found`,
          fixHint: "Wrap the web app root with ForgeWorkOSAuthProvider from ./lib/workos-auth.",
          suggestedCommands: ["forge workos doctor --json", "forge inspect ui --json"],
        }),
      ],
    };
  }
  if (current.includes("ForgeWorkOSAuthProvider")) {
    return { changed: [], warnings: [] };
  }

  const canRewriteVendorAccessRoot =
    current.includes('import { ForgeProvider, forgeUrl } from "./lib/forge";') &&
    current.includes("function LocalForgeProvider") &&
    (
      current.includes("<LocalForgeProvider persona={persona}>{app}</LocalForgeProvider>") ||
      current.includes("<LocalForgeProvider persona={signedInPersona}>")
    );

  if (canRewriteVendorAccessRoot) {
    const personaType = current.includes("LocalPersona") ? "LocalPersona" : "DemoPersona";
    const withWorkOSImport = current.replace(
      'import { ForgeProvider, forgeUrl } from "./lib/forge";',
      [
        'import { ForgeProvider, forgeUrl } from "./lib/forge";',
        'import { ForgeWorkOSAuthProvider, hasWorkOSBrowserConfig, useForgeWorkOSSession, useWorkOSAuth } from "./lib/workos-auth";',
      ].join("\n"),
    );
    if (withWorkOSImport.includes("function LoginScreen(") && !withWorkOSImport.includes("function WorkOSVendorAccessRoot()")) {
      const withWorkOSEntry = withWorkOSImport.replace(
        "function Root() {\n",
        [
          "function Root() {",
          "  if (hasWorkOSBrowserConfig()) {",
          "    return (",
          "      <ForgeWorkOSAuthProvider>",
          "        <WorkOSVendorAccessRoot />",
          "      </ForgeWorkOSAuthProvider>",
          "    );",
          "  }",
          "",
        ].join("\n"),
      );
      const workOSRoot = [
        "function WorkOSVendorAccessRoot() {",
        "  const auth = useWorkOSAuth();",
        "  const workosSession = useForgeWorkOSSession();",
        "",
        "  if (auth.isLoading || (auth.user && workosSession.loading)) {",
        "    return (",
        "      <main className=\"login-shell\">",
        "        <section className=\"login-panel\">",
        "          <p className=\"eyebrow\">Secure workspace</p>",
        "          <h1>Checking your session</h1>",
        "        </section>",
        "      </main>",
        "    );",
        "  }",
        "",
        "  if (auth.user && workosSession.error) {",
        "    return (",
        "      <main className=\"login-shell\">",
        "        <section className=\"login-panel\">",
        "          <p className=\"eyebrow\">Identity provider</p>",
        "          <h1>Session unavailable</h1>",
        "          <p className=\"notice error\">{workosSession.error.message}</p>",
        "          <div className=\"login-form\">",
        "            <button type=\"button\" onClick={() => void workosSession.refresh()}>Retry session</button>",
        "            <button className=\"secondary\" type=\"button\" onClick={() => auth.signOut({ returnTo: window.location.origin })}>Sign out</button>",
        "          </div>",
        "        </section>",
        "      </main>",
        "    );",
        "  }",
        "",
        "  if (!auth.user) {",
        "    return (",
        "      <main className=\"login-shell\">",
        "        <section className=\"login-panel\">",
        "          <div className=\"brand login-brand\">",
        "            <span className=\"brand-mark\">VA</span>",
        "            <div>",
        "              <strong>Vendor Access</strong>",
        "              <span>Risk operations</span>",
        "            </div>",
        "          </div>",
        "          <p className=\"eyebrow\">WorkOS AuthKit</p>",
        "          <h1>Sign in to review vendor access</h1>",
        "          <div className=\"login-form\">",
        "            <button type=\"button\" onClick={() => void auth.signIn()}>Sign in with WorkOS</button>",
        "            <button className=\"secondary\" type=\"button\" onClick={() => void auth.signUp()}>Create account</button>",
        "          </div>",
        "        </section>",
        "        <aside className=\"login-context\">",
        "          <span>Identity provider</span>",
        "          <strong>AuthKit session required</strong>",
        "          <p>Organization, role, and permissions come from your signed-in workspace session.</p>",
        "        </aside>",
        "      </main>",
        "    );",
        "  }",
        "",
        "  const claims = workosSession.session?.claims;",
        "  const email = workosSession.session?.user?.email ?? auth.user.email ?? claims?.email ?? \"workos-user@example.com\";",
        "  const organizationId = claims?.organization_id ?? \"workos-organization\";",
        "  const role = claims?.role ?? claims?.roles?.[0] ?? \"member\";",
        "  const permissions = claims?.permissions ?? [];",
        `  const persona: ${personaType} = {`,
        "    id: `workos:${organizationId}:${email}`,",
        "    label: email,",
        "    email,",
        "    organizationId,",
        "    organizationName: organizationId,",
        "    role,",
        "    permissions,",
        "  };",
        "",
        "  return (",
        "    <App",
        "      persona={persona}",
        "      personas={[persona]}",
        "      onPersonaChange={() => undefined}",
        "      onSignOut={() => auth.signOut({ returnTo: window.location.origin })}",
        "    />",
        "  );",
        "}",
        "",
      ].join("\n");
      const next = withWorkOSEntry.replace("function LoginScreen(", `${workOSRoot}function LoginScreen(`);
      if (next !== current) {
        nodeFileSystem.writeText(mainPath, next);
        return { changed: [mainRel], warnings: [] };
      }
    }
    let next = withWorkOSImport.replace(
      "<LocalForgeProvider persona={persona}>{app}</LocalForgeProvider>",
      [
        "hasWorkOSBrowserConfig() ? (",
        "      <ForgeWorkOSAuthProvider>{app}</ForgeWorkOSAuthProvider>",
        "    ) : (",
        "      <LocalForgeProvider persona={persona}>{app}</LocalForgeProvider>",
        "    )",
      ].join("\n    "),
    );
    if (next === withWorkOSImport) {
      const rootReturn = /  return \(\n    <LocalForgeProvider persona=\{signedInPersona\}>\n([\s\S]*?)    <\/LocalForgeProvider>\n  \);/m;
      next = withWorkOSImport.replace(rootReturn, (_match, appBody: string) => {
        const app = String(appBody).replace(/^      /gm, "    ");
        return [
          "  const app = (",
          app.trimEnd(),
          "  );",
          "",
          "  return hasWorkOSBrowserConfig() ? (",
          "    <ForgeWorkOSAuthProvider>{app}</ForgeWorkOSAuthProvider>",
          "  ) : (",
          "    <LocalForgeProvider persona={signedInPersona}>{app}</LocalForgeProvider>",
          "  );",
        ].join("\n");
      });
    }
    if (next !== current) {
      nodeFileSystem.writeText(mainPath, next);
      return { changed: [mainRel], warnings: [] };
    }
  }

  const canRewriteDefaultViteRoot =
    current.includes('import { ForgeProvider, forgeUrl } from "./lib/forge";') &&
    current.includes("<ForgeProvider url={forgeUrl} devAuth>") &&
    current.includes("</ForgeProvider>");

  if (!canRewriteDefaultViteRoot) {
    return {
      changed: [],
      warnings: [
        createDiagnostic({
          severity: "warning",
          code: "FORGE_WORKOS_AUTHKIT_ROOT_CUSTOM",
          message: `generated WorkOS AuthKit bridge, but ${mainRel} is custom and was not rewritten automatically`,
          fixHint: "Import ForgeWorkOSAuthProvider from ./lib/workos-auth and wrap the app root with it so AuthKit tokens are passed to ForgeProvider.",
          suggestedCommands: ["forge workos doctor --json", "forge inspect ui --json"],
        }),
      ],
    };
  }

  const next = current
    .replace(
      'import { ForgeProvider, forgeUrl } from "./lib/forge";',
      'import { ForgeWorkOSAuthProvider } from "./lib/workos-auth";',
    )
    .replace("<ForgeProvider url={forgeUrl} devAuth>", "<ForgeWorkOSAuthProvider>")
    .replace("</ForgeProvider>", "</ForgeWorkOSAuthProvider>");

  if (next !== current) {
    nodeFileSystem.writeText(mainPath, next);
    return { changed: [mainRel], warnings: [] };
  }
  return { changed: [], warnings: [] };
}

async function analyzeRecipePackages(
  recipe: IntegrationRecipe,
  ctx: ReturnType<typeof discover>,
  installRoot: string,
  options: ForgeAddOptions,
): Promise<{ classified: ClassifiedPackage[]; diagnostics: Diagnostic[] }> {
  const compiler = new PackageGraphCompiler();
  const classified: ClassifiedPackage[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const pkg of recipe.packages) {
    const dep = dependencyFromInstall(
      pkg.packageName,
      "0.0.0",
      ctx.workspaceRoot,
      ctx.packageManager,
      installRoot,
    );

    const pkgJsonPath = join(dep.installPath, "package.json");
    if (nodeFileSystem.exists(pkgJsonPath)) {
      const installed = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
        version?: string;
      };
      if (installed.version) {
        dep.version = installed.version;
      }
    }

    try {
      const result = await compiler.analyze(dep, {
        runtimeInspect: options.runtimeInspect,
        sandboxBackend: options.sandboxBackend,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        recipeVersion: recipe.recipeVersion,
      });
      classified.push({
        api: result,
        classification: classify(result, recipe),
        recipe,
      });
    } catch (error) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_ADD_ANALYZE_FAILED",
          message: `failed to analyze ${pkg.packageName}: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  return { classified, diagnostics };
}

async function buildAddPlan(
  alias: string,
  recipe: IntegrationRecipe,
  ctx: ReturnType<typeof discover>,
  installRoot: string,
  options: ForgeAddOptions,
): Promise<{
  emitPlan: ReturnType<typeof buildIntegrationEmitPlan>;
  warnings: Diagnostic[];
  errors: Diagnostic[];
}> {
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });

  const { classified, diagnostics } = await analyzeRecipePackages(
    recipe,
    ctx,
    installRoot,
    options,
  );

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = [
    ...appGraph.diagnostics.filter((item) => item.severity === "warning"),
    ...diagnostics.filter((item) => item.severity === "warning"),
  ];

  if (classified.length === 0) {
    errors.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_ANALYZE_FAILED",
        message: `no packages analyzed for alias '${alias}'`,
      }),
    );
    return {
      emitPlan: {
        files: [],
        orphanedFiles: [],
        lock: loadExistingForgeLock(options.workspaceRoot) ?? {
          schemaVersion: FORGE_LOCK_SCHEMA_VERSION,
          generatorVersion: GENERATOR_VERSION,
          analyzerVersion: PACKAGE_ANALYZER_VERSION,
          inputHash: ctx.inputFingerprint,
          lockfileHash: ctx.lockfileHash,
          packageManager: ctx.packageManager,
          packages: [],
        },
      },
      warnings,
      errors,
    };
  }

  const allClassified = await collectAllClassified(
    discover({ workspaceRoot: options.workspaceRoot }),
    ctx.cacheDir,
    false,
    "none",
  );

  const emitPlan = buildIntegrationEmitPlan({
    alias,
    recipe,
    classified,
    allClassified,
    appGraph,
    ctx,
    existingLock: loadExistingForgeLock(options.workspaceRoot),
  });

  return { emitPlan, warnings, errors };
}

export async function forgeAdd(
  alias: string,
  options: ForgeAddOptions,
): Promise<ForgeAddResult> {
  const packageRequestResult = normalizePackageRequest(alias, options);
  const packageRequest = packageRequestResult.request;
  const effectiveOptions: ForgeAddOptions = {
    ...options,
    installWorkspace: packageRequest.installWorkspace,
  };
  const packageModeRequested =
    options.mode === "package" ||
    packageRequest.forcePackageMode ||
    options.packageTarget !== undefined;
  if (packageRequestResult.error && packageModeRequested) {
    return finalizeAddResult({
      alias: packageRequest.spec,
      mode: "package",
      target: packageRequest.installWorkspace ?? packageRequest.packageTarget,
      packageTarget: packageRequest.packageTarget,
      packageTargetReason: packageRequest.packageTargetReason,
      packageSpec: packageRequest.spec,
      packageName: parsePackageName(packageRequest.spec),
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [packageRequestResult.error],
      exitCode: 1,
      failureKind: "invalid_workspace",
    });
  }
  if (options.mode === "integration" && (packageRequest.forcePackageMode || options.packageTarget)) {
    const error = createDiagnostic({
      severity: "error",
      code: "FORGE_ADD_SCOPED_INTEGRATION",
      message: "frontend/backend package targets only apply to normal npm package installs, not explicit integration recipes",
      fixHint: "Use forge add package <spec> --frontend, forge add frontend:<spec>, or remove the frontend/backend target for an integration recipe.",
      suggestedCommands: [
        `forge add package ${packageRequest.spec} --frontend --dry-run --json`,
        `forge add integration ${packageRequest.spec} --dry-run --json`,
      ],
    });
    return finalizeAddResult({
      alias: packageRequest.spec,
      mode: "integration",
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [error],
      exitCode: 1,
      failureKind: "invalid_target",
    });
  }

  const normalized = packageRequest.spec.trim().toLowerCase();
  const recipe = resolveRecipe(normalized);
  const mode = options.mode ?? "auto";

  if (packageModeRequested) {
    return forgeAddPackage(packageRequest.spec, effectiveOptions, packageRequest);
  }

  if (mode === "auto" && (!isReferenceAlias(normalized) || recipe === null)) {
    return forgeAddPackage(packageRequest.spec, effectiveOptions, packageRequest);
  }

  if (!isReferenceAlias(normalized) || recipe === null) {
    const error = createDiagnostic({
      severity: "error",
      code: "FORGE_UNKNOWN_ALIAS",
      message: `unknown integration alias '${alias}'; supported: stripe, posthog, sentry, zod, convex, workos, ai. For npm packages, use 'forge add package ${alias}' or 'forge add ${alias}'.`,
      suggestedCommands: [`forge add package ${alias} --dry-run --json`, "forge add --help"],
    });
    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [error],
      exitCode: 1,
      failureKind: "unknown_alias",
    });
  }

  const effectiveRecipe = applyWorkOSRecipeProfile(recipe, effectiveOptions);

  const pm =
    options.pmAdapter ??
    detectAndCreatePackageManagerAdapter(options.workspaceRoot);

  if (options.dryRun) {
    const ctx = discover({ workspaceRoot: effectiveOptions.workspaceRoot });
    let installRoot = options.workspaceRoot;

    try {
      const dryRun = await pm.dryRunAddWithPath(
        effectiveRecipe.packages.map((pkg) => pkg.packageName).join(" "),
        {
          cwd: options.workspaceRoot,
          ignoreScripts: !options.allowScripts,
        },
      );
      installRoot = dryRun.installPath;
    } catch {
      const fallback = dryRunRecipeFallbackMessage(normalized);
      const { emitPlan, warnings, errors } = await buildAddPlan(
        normalized,
        effectiveRecipe,
        ctx,
        installRoot,
        effectiveOptions,
      );
      warnings.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DRY_RUN_FALLBACK",
          message: fallback,
        }),
      );

      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(effectiveRecipe),
        changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
        unchanged: [],
        warnings,
        errors,
        exitCode: errors.length > 0 ? 1 : 0,
        failureKind: failureKind(errors),
      });
    }

    const { emitPlan, warnings, errors } = await buildAddPlan(
      normalized,
      effectiveRecipe,
      ctx,
      installRoot,
      effectiveOptions,
    );

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(effectiveRecipe),
      changed: [...emitPlan.files.map((file) => file.path), "forge.lock"],
      unchanged: [],
      warnings,
      errors,
      exitCode: errors.length > 0 ? 1 : 0,
      failureKind: failureKind(errors),
    });
  }

  const snapshot = snapshotVersionControlled(options.workspaceRoot);

  try {
    const frontendWorkspace = normalized === "workos" ? workosFrontendWorkspace(options.workspaceRoot) : undefined;
    const packageManagerBefore = snapshotPackageManagerFiles(
      options.workspaceRoot,
      pm,
      frontendWorkspace ? [packageJsonRelativeFor(frontendWorkspace)] : [],
    );
    const preinstalledWarnings: Diagnostic[] = [];
    for (const pkg of effectiveRecipe.packages) {
      const rootPackageJson = join(options.workspaceRoot, "package.json");
      await addPackageOrContinueIfInstalled({
        pm,
        packageName: pkg.packageName,
        workspaceRoot: options.workspaceRoot,
        installRoot: options.workspaceRoot,
        packageJsonPath: rootPackageJson,
        ignoreScripts: !options.allowScripts,
        warnings: preinstalledWarnings,
        doctorCommand: "forge check --json",
        allowInstalledFallback: normalized === "workos",
      });
    }
    if (frontendWorkspace) {
      const frontendPackageJson = join(options.workspaceRoot, frontendWorkspace, "package.json");
      await addPackageOrContinueIfInstalled({
        pm,
        packageName: "@workos-inc/authkit-react",
        workspaceRoot: options.workspaceRoot,
        installRoot: join(options.workspaceRoot, frontendWorkspace),
        packageJsonPath: frontendPackageJson,
        ignoreScripts: !options.allowScripts,
        warnings: preinstalledWarnings,
        doctorCommand: "forge workos doctor --json",
        allowInstalledFallback: true,
      });
    }

    const ctx = discover({ workspaceRoot: options.workspaceRoot });
    const { emitPlan, warnings, errors: analyzeErrors } = await buildAddPlan(
      normalized,
      effectiveRecipe,
      ctx,
      options.workspaceRoot,
      options,
    );

    if (analyzeErrors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(effectiveRecipe),
        changed: [],
        unchanged: [],
        warnings,
        errors: analyzeErrors,
        exitCode: 1,
        failureKind: failureKind(analyzeErrors),
      });
    }

    const emitResult = await emit(emitPlan, {
      workspaceRoot: options.workspaceRoot,
      mode: "write",
    });

    const workosWeb = normalized === "workos" && frontendWorkspace
      ? connectWorkOSReactRoot(options.workspaceRoot, frontendWorkspace)
      : { changed: [] as string[], warnings: [] as Diagnostic[] };

    const warningsCombined = [...preinstalledWarnings, ...warnings, ...emitResult.warnings, ...workosWeb.warnings];
    const errors = [...analyzeErrors, ...emitResult.errors];

    if (errors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(effectiveRecipe),
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors,
        exitCode: 1,
        failureKind: failureKind(errors),
      });
    }

    const integrityErrors = verifyLockIntegrity(
      options.workspaceRoot,
      emitPlan.lock,
    );
    if (integrityErrors.length > 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "integration",
        ...recipeResultMetadata(effectiveRecipe),
        changed: [],
        unchanged: [],
        warnings: warningsCombined,
        errors: integrityErrors,
        exitCode: 1,
        failureKind: "lock_integrity",
      });
    }

    const manifest = loadManifest(ctx.cacheDir);
    const appGraph = await buildAppGraph({
      workspaceRoot: ctx.workspaceRoot,
      sources: ctx.sources,
      prior: manifest.priorAppGraph,
      tsconfigPath: ctx.tsconfigPath ?? undefined,
    });

    saveManifest(
      ctx.cacheDir,
      updateManifestAfterWrite(
        manifest,
        Object.fromEntries(
          emitPlan.files.map((file) => [
            file.path,
            hashStable(renderBody(file)),
          ]),
        ),
        appGraph,
        ctx.inputFingerprint,
      ),
    );

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(effectiveRecipe),
      changed: [
        ...changedPackageManagerFiles(options.workspaceRoot, packageManagerBefore),
        ...emitResult.changed,
        ...workosWeb.changed,
      ],
      unchanged: emitResult.unchanged,
      warnings: warningsCombined,
      errors: [],
      exitCode: 0,
    });
  } catch (error) {
    restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);

    const message =
      error instanceof PackageManagerCommandError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const diagnostic = createDiagnostic({
      severity: "error",
      code: "FORGE_ADD_INSTALL_FAILED",
      message: `forge add failed: ${message}`,
    });

    return finalizeAddResult({
      alias: normalized,
      mode: "integration",
      ...recipeResultMetadata(effectiveRecipe),
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [diagnostic],
      exitCode: 1,
      failureKind: "install_failed",
    });
  }
}

async function forgeAddPackage(
  spec: string,
  options: ForgeAddOptions,
  request = normalizePackageRequest(spec, options).request,
): Promise<ForgeAddResult> {
  const normalized = request.spec.trim();
  const packageName = parsePackageName(normalized);
  const target = resolveInstallRoot(options);
  if (target.error) {
    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      packageTarget: request.packageTarget,
      packageTargetReason: request.packageTargetReason,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [target.error],
      exitCode: 1,
      failureKind: "invalid_workspace",
    });
  }

  const pm =
    options.pmAdapter ??
    detectAndCreatePackageManagerAdapter(options.workspaceRoot);
  const packageManagerCwd = target.installRoot;
  const semanticInstallWorkspace = target.target === "root" ? undefined : target.target;
  const installCommand = buildAddCommand(pm.name, normalized, {
    ignoreScripts: !options.allowScripts,
    workspace: undefined,
  });
  const avoidedManualCommand = installCommand.join(" ");
  const installPlan = {
    packageSpec: normalized,
    packageName,
    packageManager: pm.name,
    installCommand,
    nativeInstallCommand: installCommand,
    avoidedManualCommand,
    installCwd: packageManagerCwd.replace(/\\/g, "/"),
    packageTarget: request.packageTarget,
    packageTargetReason: request.packageTargetReason,
    ...(semanticInstallWorkspace ? { installWorkspace: semanticInstallWorkspace } : {}),
  };

  if (options.dryRun) {
    try {
      await pm.dryRunAdd(normalized, {
        cwd: packageManagerCwd,
        ignoreScripts: !options.allowScripts,
        workspace: undefined,
      });
    } catch (error) {
      const message =
        error instanceof PackageManagerCommandError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      const diagnostic = createDiagnostic({
        severity: "error",
        code: "FORGE_ADD_INSTALL_FAILED",
        message: `forge add package dry-run failed: ${message}`,
      });
      return finalizeAddResult({
        alias: normalized,
        mode: "package",
        target: target.target,
        ...installPlan,
        changed: [],
        unchanged: [],
        warnings: [],
        errors: [diagnostic],
        exitCode: 1,
        failureKind: "install_failed",
      });
    }

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [
        packageJsonRelativeFor(target.target === "root" ? undefined : target.target),
      ],
      unchanged: [],
      warnings: [],
      errors: [],
      exitCode: 0,
    });
  }

  const snapshot = snapshotVersionControlled(
    options.workspaceRoot,
    target.extraSnapshotPaths,
  );

  try {
    await pm.add(normalized, {
      cwd: packageManagerCwd,
      ignoreScripts: !options.allowScripts,
      workspace: undefined,
    });

    const generated = await runGenerate({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: options.json,
      concurrency: 4,
    });

    if (generated.exitCode !== 0) {
      restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);
      return finalizeAddResult({
        alias: normalized,
        mode: "package",
        target: target.target,
        ...installPlan,
        changed: [],
        unchanged: [],
        warnings: generated.warnings,
        errors: generated.errors,
        exitCode: 1,
        failureKind: generated.failureKind,
      });
    }

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [
        packageJsonRelativeFor(target.target === "root" ? undefined : target.target),
        ...generated.changed,
      ],
      unchanged: generated.unchanged,
      warnings: generated.warnings,
      errors: generated.errors,
      exitCode: 0,
    });
  } catch (error) {
    restoreVersionControlledSnapshot(options.workspaceRoot, snapshot);

    const message =
      error instanceof PackageManagerCommandError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const diagnostic = createDiagnostic({
      severity: "error",
      code: "FORGE_ADD_INSTALL_FAILED",
      message: `forge add package failed: ${message}`,
    });

    return finalizeAddResult({
      alias: normalized,
      mode: "package",
      target: target.target,
      ...installPlan,
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [diagnostic],
      exitCode: 1,
      failureKind: "install_failed",
    });
  }
}

/** Test helper: seed fixture packages into node_modules and update package.json. */
export function seedWorkspacePackage(
  workspaceRoot: string,
  packageName: string,
  fixtureRoot: string,
): void {
  const segments = packageName.startsWith("@")
    ? packageName.slice(1).split("/")
    : [packageName];
  const target = join(workspaceRoot, "node_modules", ...segments);
  nodeFileSystem.mkdirp(target);
  nodeFileSystem.copy(join(fixtureRoot, ...segments), target);

  const pkgJsonPath = join(workspaceRoot, "package.json");
  const pkg = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
    dependencies?: Record<string, string>;
  };
  pkg.dependencies = {
    ...pkg.dependencies,
    [packageName]: "1.0.0",
  };
  nodeFileSystem.writeText(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
