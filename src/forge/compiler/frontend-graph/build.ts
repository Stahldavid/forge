import { basename, dirname, join, relative } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { ClientManifest } from "../client-sdk/build-manifest.ts";
import type {
  FrontendClientBindingInfo,
  FrontendComponentInfo,
  FrontendGraph,
  FrontendProviderInfo,
  FrontendRouteInfo,
} from "../types/frontend-graph.ts";
import { serializeCanonical } from "../primitives/serialize.ts";

const WEB_ROOT = "web";
const API_URL_ENV = "NEXT_PUBLIC_FORGE_URL";
const VITE_API_URL_ENV = "VITE_FORGE_URL";

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort();
}

function readJson<T>(path: string): T | null {
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(path) ?? "") as T;
  } catch {
    return null;
  }
}

function walkFiles(root: string): string[] {
  if (!nodeFileSystem.exists(root)) {
    return [];
  }
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of nodeFileSystem.readDir(dir)) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") {
          continue;
        }
        walk(absolute);
      } else if (entry.isFile) {
        files.push(absolute);
      }
    }
  }
  walk(root);
  return files.sort((a, b) => toPosix(a).localeCompare(toPosix(b)));
}

type WebPackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function detectFramework(webRoot: string): FrontendGraph["framework"] {
  const pkg = readJson<WebPackageJson>(
    join(webRoot, "package.json"),
  );
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next || nodeFileSystem.exists(join(webRoot, "next.config.ts"))) {
    return "next";
  }
  if (deps.vite || nodeFileSystem.exists(join(webRoot, "vite.config.ts"))) {
    return "vite";
  }
  if (nodeFileSystem.exists(join(webRoot, "index.html"))) {
    return "static";
  }
  return "unknown";
}

function detectPackageManager(pkg: WebPackageJson | null): FrontendGraph["webManifest"]["packageManager"] {
  const raw = pkg?.packageManager;
  if (raw?.startsWith("bun@")) return "bun";
  if (raw?.startsWith("pnpm@")) return "pnpm";
  if (raw?.startsWith("yarn@")) return "yarn";
  if (raw?.startsWith("npm@")) return "npm";
  return raw ? "unknown" : undefined;
}

function routePathForFile(webRoot: string, file: string): string | null {
  const rel = toPosix(relative(webRoot, file));
  if (rel === "index.html") {
    return "/";
  }
  if (
    rel === "src/App.tsx" ||
    rel === "src/App.ts" ||
    rel === "src/App.jsx" ||
    rel === "src/App.js"
  ) {
    return "/";
  }
  if (rel === "app/page.tsx" || rel === "app/page.ts" || rel === "app/page.jsx" || rel === "app/page.js") {
    return "/";
  }
  const match = rel.match(/^app\/(.+)\/page\.(tsx|ts|jsx|js)$/);
  if (match) {
    const route = match[1]
      .split("/")
      .filter((segment) => !segment.startsWith("(") && !segment.endsWith(")"))
      .join("/");
    return `/${route}`;
  }
  return null;
}

function componentNameForFile(file: string): string {
  return basename(file).replace(/\.(tsx|ts|jsx|js)$/, "");
}

function componentNameForText(file: string, text: string): string {
  const exportMatch = text.match(/export\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
  if (exportMatch?.[1]) {
    return exportMatch[1];
  }
  const fnMatch = text.match(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/);
  if (fnMatch?.[1]) {
    return fnMatch[1];
  }
  return componentNameForFile(file);
}

function isComponentFile(webRoot: string, file: string, text: string): boolean {
  const rel = toPosix(relative(webRoot, file));
  if (!/\.(tsx|jsx)$/.test(file)) {
    return false;
  }
  if (rel === "src/main.tsx" || rel === "src/main.jsx") {
    return false;
  }
  if (rel.startsWith("components/") || rel.startsWith("src/components/")) {
    return true;
  }
  return /export\s+(default\s+)?function\s+[A-Z]/.test(text) || /<[A-Z][A-Za-z0-9_.]*[\s/>]/.test(text);
}

function detectUses(text: string, clientManifest: ClientManifest) {
  const rawForgeFetches = [
    ...[...text.matchAll(/fetch\((["'`])([^"'`]*(?:\/commands\/|\/queries\/|\/live\/)[^"'`]*)\1/g)]
      .map((match) => match[2] ?? ""),
    ...[...text.matchAll(/(["'`])(\/(?:commands|queries|live)\/[^"'`]+)\1/g)]
      .map((match) => match[2] ?? ""),
  ];
  return {
    usesCommands: uniqueSorted(clientManifest.commands.filter((name) => text.includes(name))),
    usesQueries: uniqueSorted(clientManifest.queries.filter((name) => text.includes(name))),
    usesLiveQueries: uniqueSorted(clientManifest.liveQueries.filter((name) => text.includes(name))),
    rawForgeFetches: uniqueSorted(rawForgeFetches),
  };
}

function mergeUses(
  left: ReturnType<typeof detectUses>,
  right: ReturnType<typeof detectUses>,
): ReturnType<typeof detectUses> {
  return {
    usesCommands: uniqueSorted([...left.usesCommands, ...right.usesCommands]),
    usesQueries: uniqueSorted([...left.usesQueries, ...right.usesQueries]),
    usesLiveQueries: uniqueSorted([...left.usesLiveQueries, ...right.usesLiveQueries]),
    rawForgeFetches: uniqueSorted([...left.rawForgeFetches, ...right.rawForgeFetches]),
  };
}

function detectRouteUses(file: string, text: string, clientManifest: ClientManifest) {
  let uses = detectUses(text, clientManifest);
  if (!file.endsWith(".html")) {
    return uses;
  }
  for (const match of text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const scriptPath = match[1];
    if (!scriptPath || /^https?:\/\//.test(scriptPath)) {
      continue;
    }
    const absolute = join(dirname(file), scriptPath.replace(/^\//, ""));
    if (nodeFileSystem.exists(absolute)) {
      uses = mergeUses(uses, detectUses(nodeFileSystem.readText(absolute) ?? "", clientManifest));
    }
  }
  return uses;
}

function devCommandFor(webRoot: string, framework: FrontendGraph["framework"]): string {
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(webRoot, "package.json"));
  if (pkg?.scripts?.dev) {
    return "cd web && bun run dev";
  }
  if (nodeFileSystem.exists(join(webRoot, "server.ts"))) {
    return "bun web/server.ts";
  }
  if (framework === "static") {
    return "forge dev --web";
  }
  return "none";
}

function apiEnvFor(framework: FrontendGraph["framework"]): string {
  return framework === "vite" || framework === "static" ? VITE_API_URL_ENV : API_URL_ENV;
}

function defaultWebPort(framework: FrontendGraph["framework"]): number {
  return framework === "next" ? 3000 : 5173;
}

function componentNamesInText(text: string, components: FrontendComponentInfo[]): string[] {
  return uniqueSorted(
    components
      .filter((component) => new RegExp(`<${component.name}(\\s|>|/)`).test(text))
      .map((component) => component.name),
  );
}

function bindingEntries(input: {
  file: string;
  route?: string;
  component?: string;
  usesCommands: string[];
  usesQueries: string[];
  usesLiveQueries: string[];
  rawForgeFetches: string[];
}): FrontendClientBindingInfo[] {
  return [
    ...input.usesCommands.map((name) => ({ kind: "command" as const, name })),
    ...input.usesQueries.map((name) => ({ kind: "query" as const, name })),
    ...input.usesLiveQueries.map((name) => ({ kind: "liveQuery" as const, name })),
    ...input.rawForgeFetches.map((name) => ({ kind: "rawFetch" as const, name })),
  ].map((binding) => ({
    ...binding,
    file: input.file,
    ...(input.route ? { route: input.route } : {}),
    ...(input.component ? { component: input.component } : {}),
  }));
}

export function buildFrontendGraph(input: {
  workspaceRoot: string;
  clientManifest: ClientManifest;
  apiPort?: number;
  webPort?: number;
}): FrontendGraph {
  const webRoot = join(input.workspaceRoot, WEB_ROOT);
  if (!nodeFileSystem.exists(webRoot)) {
    return {
      schemaVersion: "0.1.0",
      present: false,
      framework: "none",
      routes: [],
      components: [],
      providers: [],
      bridgeFiles: [],
      webManifest: {
        present: false,
        framework: "none",
        scripts: {},
        urls: {
          api: `http://127.0.0.1:${input.apiPort ?? 3765}`,
        },
        env: {
          apiUrl: API_URL_ENV,
        },
        bridge: {
          files: [],
          valid: false,
        },
      },
      clientBindings: [],
      diagnostics: [],
    };
  }

  const pkg = readJson<WebPackageJson>(join(webRoot, "package.json"));
  const framework = detectFramework(webRoot);
  const apiUrlEnv = apiEnvFor(framework);
  const defaultApiUrl = `http://127.0.0.1:${input.apiPort ?? 3765}`;
  const devUrl = `http://127.0.0.1:${input.webPort ?? defaultWebPort(framework)}`;
  const files = walkFiles(webRoot);
  const sourceFiles = files.filter((file) => /\.(tsx|ts|jsx|js|html)$/.test(file));
  const routes: FrontendRouteInfo[] = [];
  const components: FrontendComponentInfo[] = [];
  const providers: FrontendProviderInfo[] = [];
  const bridgeFiles: string[] = [];
  const diagnostics: FrontendGraph["diagnostics"] = [];
  const textByRel = new Map<string, string>();

  for (const file of sourceFiles) {
    const rel = toPosix(relative(input.workspaceRoot, file));
    const text = nodeFileSystem.readText(file) ?? "";
    const isBridgeFile =
      rel === "web/lib/forge.ts" ||
      rel === "web/lib/forge.tsx" ||
      rel === "web/src/lib/forge.ts" ||
      rel === "web/src/lib/forge.tsx";
    textByRel.set(rel, text);
    const uses = detectUses(text, input.clientManifest);
    if (isComponentFile(webRoot, file, text)) {
      components.push({ name: componentNameForText(file, text), file: rel, ...uses });
    }
    if (!isBridgeFile && text.includes("ForgeProvider")) {
      providers.push({
        name: "ForgeProvider",
        file: rel,
        ...(text.includes(API_URL_ENV) ? { apiUrlEnv: API_URL_ENV } : {}),
        ...(text.includes(VITE_API_URL_ENV) ? { apiUrlEnv: VITE_API_URL_ENV } : {}),
        devAuth:
          text.includes("devAuth") ||
          (text.includes("userId") && text.includes("tenantId") && text.includes("role")),
      });
    }
    if (
      rel === "web/lib/forge.ts" ||
      rel === "web/lib/forge.tsx" ||
      rel === "web/src/lib/forge.ts" ||
      rel === "web/src/lib/forge.tsx"
    ) {
      bridgeFiles.push(rel);
    }
    if (!isBridgeFile && (/from\s+["']\.\.\/\.\.\/src\/forge\/_generated/.test(text) || /from\s+["'][^"']*\/src\/forge\/_generated/.test(text))) {
      diagnostics.push({
        severity: "warning",
        code: "FORGE_FRONTEND_SERVER_IMPORT",
        message: "frontend imports generated files directly; prefer the local web/lib/forge bridge",
        file: rel,
      });
    }
    if (uses.rawForgeFetches.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "FORGE_FRONTEND_DIRECT_RUNTIME_FETCH",
        message: "frontend calls Forge runtime endpoints directly; prefer generated hooks from the web bridge",
        file: rel,
      });
    }
  }

  for (const file of sourceFiles) {
    const rel = toPosix(relative(input.workspaceRoot, file));
    const text = textByRel.get(rel) ?? "";
    const routePath = routePathForFile(webRoot, file);
    if (routePath) {
      if (framework === "vite" && rel === "web/index.html") {
        continue;
      }
      const componentNames = componentNamesInText(text, components);
      const componentUses = components
        .filter((component) => componentNames.includes(component.name))
        .reduce(
          (acc, component) =>
            mergeUses(acc, {
              usesCommands: component.usesCommands,
              usesQueries: component.usesQueries,
              usesLiveQueries: component.usesLiveQueries,
              rawForgeFetches: component.rawForgeFetches,
            }),
          detectRouteUses(file, text, input.clientManifest),
        );
      routes.push({
        path: routePath,
        file: rel,
        components: componentNames,
        ...componentUses,
      });
    }
  }

  if (providers.length === 0 && framework !== "static") {
    diagnostics.push({
      severity: "warning",
      code: "FORGE_FRONTEND_PROVIDER_MISSING",
      message: "web app does not expose a ForgeProvider; generated hooks may not be wired",
    });
  }
  if (bridgeFiles.length === 0 && framework !== "static") {
    diagnostics.push({
      severity: "warning",
      code: "FORGE_FRONTEND_BRIDGE_MISSING",
      message: "web/**/lib/forge.ts bridge is missing; agents may use fragile generated import paths",
    });
  }

  const clientBindings = uniqueSorted([
    ...routes.flatMap((route) =>
      bindingEntries({
        file: route.file,
        route: route.path,
        usesCommands: route.usesCommands,
        usesQueries: route.usesQueries,
        usesLiveQueries: route.usesLiveQueries,
        rawForgeFetches: route.rawForgeFetches,
      }).map((binding) => JSON.stringify(binding)),
    ),
    ...components.flatMap((component) =>
      bindingEntries({
        file: component.file,
        component: component.name,
        usesCommands: component.usesCommands,
        usesQueries: component.usesQueries,
        usesLiveQueries: component.usesLiveQueries,
        rawForgeFetches: component.rawForgeFetches,
      }).map((binding) => JSON.stringify(binding)),
    ),
  ]).map((binding) => JSON.parse(binding) as FrontendClientBindingInfo);

  return {
    schemaVersion: "0.1.0",
    present: true,
    framework,
    root: WEB_ROOT,
    dev: {
      command: devCommandFor(webRoot, framework),
      url: devUrl,
      apiUrlEnv,
      defaultApiUrl,
    },
    routes: routes.sort((a, b) => a.path.localeCompare(b.path)),
    components: components.sort((a, b) => a.file.localeCompare(b.file)),
    providers: providers.sort((a, b) => a.file.localeCompare(b.file)),
    bridgeFiles: uniqueSorted(bridgeFiles),
    webManifest: {
      present: true,
      framework,
      root: WEB_ROOT,
      ...(detectPackageManager(pkg) ? { packageManager: detectPackageManager(pkg) } : {}),
      scripts: {
        ...(pkg?.scripts?.dev ? { dev: pkg.scripts.dev } : {}),
        ...(pkg?.scripts?.build ? { build: pkg.scripts.build } : {}),
        ...(pkg?.scripts?.typecheck ? { typecheck: pkg.scripts.typecheck } : {}),
      },
      urls: {
        dev: devUrl,
        api: defaultApiUrl,
      },
      env: {
        apiUrl: apiUrlEnv,
      },
      bridge: {
        files: uniqueSorted(bridgeFiles),
        valid: bridgeFiles.length > 0,
      },
    },
    clientBindings: clientBindings.sort((a, b) =>
      `${a.file}:${a.kind}:${a.name}`.localeCompare(`${b.file}:${b.kind}:${b.name}`),
    ),
    diagnostics,
  };
}

export function serializeFrontendGraphJson(graph: FrontendGraph): string {
  return serializeCanonical(graph);
}

export function serializeFrontendGraphTs(graph: FrontendGraph): string {
  const parsed = JSON.parse(serializeFrontendGraphJson(graph)) as unknown;
  return `export const frontendGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}
