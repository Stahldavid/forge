import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveFabricProject } from "../agent-fabric/project-registry.ts";
import { REPOSITORY_ADAPTERS, type RepositoryManifest } from "./types.ts";
export type { RepositoryManifest } from "./types.ts";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1000 && value.every(v => typeof v === "string" && v.length > 0 && v.length <= 4096);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
const path = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !isAbsolute(value) && !/[\\:\u0000-\u001f]/.test(value) && !value.split("/").includes("..");
function unknownKeys(value: Record<string, unknown>, allowed: string[], diagnostics: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) diagnostics.push(`${label}: unknown field ${key}`);
}

export function validateRepositoryManifest(value: unknown): { manifest: RepositoryManifest | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!object(value)) return { manifest: null, diagnostics: ["Repository manifest must be an object"] };
  unknownKeys(value, ["forgeProtocol", "kind", "components", "exclude", "checks", "scenario", "services"], diagnostics, "manifest");
  if (value.forgeProtocol !== "2.0" || value.kind !== "repository") diagnostics.push("Repository manifest requires forgeProtocol 2.0 and kind repository");
  const ids = new Set<string>();
  const roots = new Set<string>();
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 1000) diagnostics.push("components must contain 1..1000 components");
  else for (const component of value.components) {
    if (!object(component)) { diagnostics.push("Invalid component"); continue; }
    unknownKeys(component, ["id", "root", "adapters", "files"], diagnostics, "component");
    if (!id(component.id) || ids.has(component.id)) diagnostics.push("Component id invalid or duplicate"); else ids.add(component.id);
    if (!path(component.root)) diagnostics.push("Component root must be a relative contained path");
    else { const canonical = component.root.split("/").filter(part => part && part !== ".").join("/") || "."; const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical; if (roots.has(normalized)) diagnostics.push("Duplicate component roots"); roots.add(normalized); }
    if (!strings(component.adapters) || component.adapters.length === 0 || new Set(component.adapters).size !== component.adapters.length || component.adapters.some(a => !(REPOSITORY_ADAPTERS as readonly string[]).includes(a))) diagnostics.push("Unsupported or duplicate adapters");
    if (component.files !== undefined && (!strings(component.files) || !component.files.every(path))) diagnostics.push("files must be relative contained paths");
  }
  if (value.exclude !== undefined && (!strings(value.exclude) || !value.exclude.every(path))) diagnostics.push("exclude must contain relative patterns");
  if (value.services !== undefined && (!strings(value.services) || !value.services.every(path))) diagnostics.push("services must contain relative manifest paths");
  const checks = new Set<string>();
  if (value.checks !== undefined) {
    if (!Array.isArray(value.checks) || value.checks.length > 1000) diagnostics.push("Invalid checks");
    else for (const check of value.checks) {
      if (!object(check)) { diagnostics.push("Invalid check"); continue; }
      unknownKeys(check, ["id", "component", "argv"], diagnostics, "check");
      if (!id(check.id) || checks.has(check.id)) diagnostics.push("Check id invalid or duplicate"); else checks.add(check.id);
      if (!id(check.component) || !ids.has(check.component)) diagnostics.push("Check refers to unknown component");
      if (!strings(check.argv) || check.argv.length === 0) diagnostics.push("Check argv must be nonempty strings");
    }
  }
  if (value.scenario !== undefined) {
    if (!object(value.scenario)) diagnostics.push("scenario must be an object");
    else {
      unknownKeys(value.scenario, ["id", "composeFiles", "profiles", "mode"], diagnostics, "scenario");
      if (value.scenario.id !== undefined && !id(value.scenario.id)) diagnostics.push("Invalid scenario id");
      if (value.scenario.mode !== undefined && !id(value.scenario.mode)) diagnostics.push("Invalid scenario mode");
      if (value.scenario.profiles !== undefined && !strings(value.scenario.profiles)) diagnostics.push("Invalid scenario profiles");
      if (value.scenario.composeFiles !== undefined && (!strings(value.scenario.composeFiles) || !value.scenario.composeFiles.every(path))) diagnostics.push("Invalid scenario composeFiles");
    }
  }
  return { manifest: diagnostics.length ? null : value as unknown as RepositoryManifest, diagnostics };
}

/** Reject symlinks on every traversed segment, including the final path. */
export function containedRepositoryPath(root: string, child: string): string {
  if (!path(child)) throw new Error("Expected relative contained repository path");
  const base = realpathSync(root), target = resolve(base, child);
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new Error("Path escapes repository");
  let current = base;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Repository path cannot traverse symlinks: ${child}`);
  }
  return target;
}

export function readRepositoryManifest(root: string, options: { manifestPath?: string } = {}): { manifest: RepositoryManifest | null; diagnostics: string[] } {
  try {
    const file = options.manifestPath ? resolve(options.manifestPath) : containedRepositoryPath(root, "forge.manifest.json");
    if (!existsSync(file)) return { manifest: null, diagnostics: options.manifestPath ? ["Manifest does not exist"] : [] };
    if (/^\.env(?:\.|$)|^\.(?:npmrc|netrc)$|^id_(?:rsa|ed25519)$|credential|secret|private[-_]?key|\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(basename(file))) throw new Error("Sensitive files cannot be used as repository manifests");
    if (lstatSync(file).isSymbolicLink() || !statSync(file).isFile() || statSync(file).size > 256 * 1024) throw new Error("Invalid or excessive manifest file");
    let value: unknown;
    try { value = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("Repository manifest is not valid JSON"); }
    if (object(value) && value.forgeProtocol === "1.0" && value.kind === undefined) return { manifest: null, diagnostics: [] };
    return validateRepositoryManifest(value);
  } catch (error) { return { manifest: null, diagnostics: [String((error as Error).message)] }; }
}

export async function resolveRepositoryRoot(options: { cwd?: string; root?: string; projectId?: string; manifestPath?: string } = {}): Promise<string> {
  const selected = options.projectId ? await resolveFabricProject(options.projectId) : undefined;
  if (options.root || selected) {
    const root = realpathSync(resolve(options.cwd ?? process.cwd(), options.root ?? selected!));
    if (!statSync(root).isDirectory()) throw new Error("Repository root must be a directory");
    const identity = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (selected && identity(realpathSync(selected)) !== identity(root)) throw new Error("root and projectId identify different projects");
    return root;
  }
  if (options.manifestPath) throw new Error("External --manifest requires explicit --root or --project-id");
  let current = realpathSync(resolve(options.cwd ?? process.cwd()));
  const initial = current;
  let markerRoot: string | undefined;
  for (;;) {
    if (existsSync(join(current, "forge.manifest.json")) || existsSync(join(current, ".git"))) return current;
    if (!markerRoot && ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "package.json", "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].some(marker => existsSync(join(current, marker)))) markerRoot = current;
    const parent = dirname(current);
    if (parent === current) return markerRoot ?? initial;
    current = parent;
  }
}
