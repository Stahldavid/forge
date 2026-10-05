import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, posix, relative, resolve, sep } from "node:path";
import type { RepositoryManifest } from "../repository-manifest/types.ts";
import type { AnalysisSource, RepositoryDiagnostic, RepositoryLocation } from "./types.ts";

const IGNORED_DIRS = new Set([".git", ".forge", "node_modules", "target", "dist", "build", ".gradle", ".mvn", ".nuxt", ".output", ".next", "coverage", ".idea", ".vscode", ".aws", ".ssh", ".secrets"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".java", ".json", ".xml", ".gradle", ".kts", ".yaml", ".yml", ".properties"]);
export const MAX_REPOSITORY_FILES = 20000;
export const MAX_REPOSITORY_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_REPOSITORY_TOTAL_BYTES = 128 * 1024 * 1024;

export function hashRepositoryFile(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export function normalizeRepositoryPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function componentRootPath(path: string): string {
  const normalized = posix.normalize(normalizeRepositoryPath(path));
  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}

export function sourceLocation(text: string, start: number, end: number): RepositoryLocation {
  const coordinate = (offset: number) => {
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    return { line, column: offset - before.lastIndexOf("\n") };
  };
  const a = coordinate(start);
  const b = coordinate(end);
  return { start, end, ...a, endLine: b.line, endColumn: b.column };
}

export function isSensitiveRepositoryPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || name === ".npmrc" || name === ".netrc" || /(?:credential|secret|private[-_]?key)/i.test(name) || /\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) || name === "id_rsa" || name === "id_ed25519";
}

export function repositoryGlobMatches(path: string, glob: string): boolean {
  const pattern = normalizeRepositoryPath(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000").replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?").replace(/\u0001/g, ".*");
  return new RegExp(`^${pattern}$`).test(path);
}

export function repositoryAdapter(path: string): string {
  const name = basename(path);
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "docker";
  if (/^(?:docker-)?compose(?:[.-].*)?\.ya?ml$/i.test(name)) return "docker";
  if (/\.vue$/i.test(path)) return "vue";
  if (/\.java$/i.test(path)) return "java";
  if (name === "pom.xml" || /(?:build|settings)\.gradle(?:\.kts)?$/.test(name)) return "java-build";
  if (/\.[cm]?[jt]sx?$/.test(path)) return "typescript";
  if (name === "package.json") return "package";
  if (/^(?:tsconfig|jsconfig)(?:\..*)?\.json$/.test(name)) return "configuration";
  return "unsupported";
}

export interface RepositoryScan {
  root: string;
  sources: AnalysisSource[];
  ignored: { path: string; reason: string }[];
  diagnostics: RepositoryDiagnostic[];
}

/** Never follows symlinks or opens secret/env files. Includes tests. No processes/config evaluation. */
export function scanRepository(rootInput: string, manifest?: RepositoryManifest): RepositoryScan {
  const root = realpathSync(rootInput);
  if (!statSync(root).isDirectory()) throw new Error("Repository root must be a directory");
  const sources: AnalysisSource[] = [];
  const ignored: RepositoryScan["ignored"] = [];
  const diagnostics: RepositoryDiagnostic[] = [];
  let visited = 0;
  let totalBytes = 0;
  const componentFor = (path: string) => manifest?.components.filter((component) => {
    const componentRoot = componentRootPath(component.root);
    return (!componentRoot || path === componentRoot || path.startsWith(`${componentRoot}/`)) && (!component.files?.length || component.files.some((pattern) => repositoryGlobMatches(path, pattern) || repositoryGlobMatches(path.slice(componentRoot ? componentRoot.length + 1 : 0), pattern)));
  }).sort((a, b) => b.root.length - a.root.length)[0];
  const visit = (absolute: string) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(absolute, entry.name);
      const path = normalizeRepositoryPath(relative(root, full));
      if (++visited > MAX_REPOSITORY_FILES) throw new Error(`Repository scan limit exceeded (${MAX_REPOSITORY_FILES} entries); narrow components/exclusions`);
      if (entry.isSymbolicLink()) { ignored.push({ path, reason: "symlink" }); continue; }
      if (isSensitiveRepositoryPath(path)) { ignored.push({ path, reason: "sensitive" }); continue; }
      if (manifest?.exclude?.some((glob) => repositoryGlobMatches(path, glob) || repositoryGlobMatches(`${path}/`, glob))) { ignored.push({ path, reason: "manifest-exclusion" }); continue; }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) { ignored.push({ path, reason: "generated-or-private-directory" }); continue; }
        // Directory path may be excluded by a trailing glob before walking it.
        if (manifest?.exclude?.some((glob) => repositoryGlobMatches(`${path}/placeholder`, glob) && /\*\*$/.test(glob))) { ignored.push({ path, reason: "manifest-exclusion" }); continue; }
        if (manifest && !manifest.components.some((component) => { const scope = componentRootPath(component.root); return !scope || path === scope || path.startsWith(`${scope}/`) || scope.startsWith(`${path}/`); })) { ignored.push({ path, reason: "outside-components" }); continue; }
        const directory = lstatSync(full);
        const canonicalDirectory = realpathSync(full);
        if (!directory.isDirectory() || directory.isSymbolicLink() || canonicalDirectory !== root && !canonicalDirectory.startsWith(`${root}${sep}`)) throw new Error(`Directory changed or escaped repository during scan: ${path}`);
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const component = componentFor(path);
      if (manifest && !component) { ignored.push({ path, reason: "outside-components" }); continue; }
      const supportedText = TEXT_EXTENSIONS.has(extname(path)) || basename(path).startsWith("Dockerfile");
      if (!supportedText) { ignored.push({ path, reason: "non-analyzable-file" }); continue; }
      const before = lstatSync(full);
      if (before.isSymbolicLink() || !before.isFile()) throw new Error(`Source changed during scan: ${path}`);
      const canonical = realpathSync(full);
      if (canonical !== root && !canonical.startsWith(`${root}${sep}`)) throw new Error(`Source escapes repository: ${path}`);
      if (before.size > MAX_REPOSITORY_FILE_BYTES) { ignored.push({ path, reason: "size-limit" }); diagnostics.push({ code: "REPOSITORY_FILE_SIZE_LIMIT", file: path, severity: "warning", message: `File exceeds ${MAX_REPOSITORY_FILE_BYTES} bytes` }); continue; }
      if (totalBytes + before.size > MAX_REPOSITORY_TOTAL_BYTES) throw new Error(`Repository source budget exceeded (${MAX_REPOSITORY_TOTAL_BYTES} bytes); narrow components/exclusions`);
      const buffer = readFileSync(full);
      const after = lstatSync(full);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`Source changed during scan: ${path}`);
      if (buffer.includes(0)) { ignored.push({ path, reason: "binary-content" }); continue; }
      totalBytes += buffer.length;
      let adapter = repositoryAdapter(path);
      if (component && adapter !== "configuration" && adapter !== "package" && adapter !== "unsupported") {
        const required = adapter === "java-build" ? ["java", "maven", "gradle", "spring"] : adapter === "typescript" ? ["typescript", "javascript", "vue", "nuxt", "nextjs", "nestjs", "express"] : [adapter, ...(adapter === "java" ? ["spring"] : adapter === "vue" ? ["nuxt"] : ["compose"])];
        if (!component.adapters.some((name) => required.includes(name))) adapter = "unsupported";
      }
      sources.push({ path, text: buffer.toString("utf8"), hash: hashRepositoryFile(buffer), component: component?.id ?? "repository", adapter });
    }
  };
  visit(root);
  return { root, sources, ignored, diagnostics };
}

/** Deterministic proposal only: no files written and no package/build commands executed. */
export function discoverRepository(root: string): RepositoryManifest {
  const scan = scanRepository(root);
  if (!scan.sources.some((source) => source.adapter !== "unsupported" && source.adapter !== "configuration")) throw new Error("No supported source files or package/build descriptors found; configure a repository manifest explicitly");
  const groups = new Map<string, Set<string>>();
  for (const source of scan.sources) {
    if (["package", "java-build"].includes(source.adapter)) {
      const directory = normalizeRepositoryPath(dirname(source.path));
      const adapters = groups.get(directory) ?? new Set<string>();
      if (source.adapter === "package") {
        adapters.add("typescript");
        try {
          const pkg = JSON.parse(source.text) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if ("vue" in deps || "nuxt" in deps) adapters.add("vue");
          if ("nuxt" in deps) adapters.add("nuxt");
        } catch { /* malformed package remains discoverable with conservative defaults */ }
      } else { adapters.add("java"); adapters.add("spring"); adapters.add(basename(source.path) === "pom.xml" ? "maven" : "gradle"); }
      groups.set(directory, adapters);
    }
  }
  if (!groups.size) groups.set(".", new Set<string>());
  const allAdapters = new Set(scan.sources.map((source) => source.adapter).filter((adapter) => ["vue", "java", "docker", "typescript"].includes(adapter)));
  const rootAdapters = groups.get(".") ?? new Set<string>();
  for (const [directory, adapters] of groups) for (const source of scan.sources) {
    if (directory !== "." && !source.path.startsWith(`${directory}/`)) continue;
    const moreSpecific = [...groups.keys()].some((other) => other !== directory && other !== "." && other.length > directory.length && source.path.startsWith(`${other}/`));
    if (!moreSpecific && ["vue", "java", "docker", "typescript"].includes(source.adapter)) adapters.add(source.adapter);
  }
  if (allAdapters.has("docker")) rootAdapters.add("docker");
  if (!groups.size || groups.size === 1 && groups.has(".")) for (const adapter of allAdapters) rootAdapters.add(adapter);
  // Include loose code and infrastructure not covered by a package root.
  if (rootAdapters.size || scan.sources.some((source) => ![...groups.keys()].some((directory) => directory !== "." && source.path.startsWith(`${directory}/`)))) groups.set(".", rootAdapters.size ? rootAdapters : allAdapters);
  const used = new Set<string>();
  const components = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, adapters]) => {
    const base = path === "." ? "repository" : path.replace(/[^a-zA-Z0-9_-]/g, "-");
    let id = base; let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return { id, root: path, adapters: adapters.size ? [...adapters].sort() : ["typescript"] };
  });
  return { forgeProtocol: "2.0", kind: "repository", components };
}
