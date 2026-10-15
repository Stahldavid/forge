import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveFabricProject } from "../agent-fabric/project-registry.ts";
import { REPOSITORY_ADAPTERS, REPOSITORY_CHECK_CATEGORIES, REPOSITORY_CHECK_COSTS, REPOSITORY_RUNTIME_ARTIFACT_FORMATS, type RepositoryManifest } from "./types.ts";
export type { RepositoryManifest, RepositoryComponent, RepositoryCheck, RepositoryHttpClient, RepositoryRuntimeCommand, RepositoryRuntimeArtifact, RepositoryRuntimeObservation, RepositoryRuntimeArtifactFormat } from "./types.ts";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1000 && value.every(v => typeof v === "string" && v.length > 0 && v.length <= 4096);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value);
const path = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !isAbsolute(value) && !/[\\:\u0000-\u001f]/.test(value) && !value.split("/").includes("..");
const paths = (value: unknown): value is string[] => strings(value) && value.every(path);
const alias = (value: string): boolean => /^[A-Za-z_$@~][A-Za-z0-9_$@~./-]{0,127}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value) && !value.split("/").includes("..");
const clientId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/.test(value);
const basePath = (value: unknown): value is string => typeof value === "string" && value.length <= 2048 && /^\/(?!\/)[A-Za-z0-9_~!()*+,;=:@./-]*$/.test(value) && !value.split("/").includes("..");
function unknownKeys(value: Record<string, unknown>, allowed: string[], diagnostics: string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) diagnostics.push(`${label}: unknown field ${key}`);
}

export function validateRepositoryManifest(value: unknown): { manifest: RepositoryManifest | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!object(value)) return { manifest: null, diagnostics: ["Repository manifest must be an object"] };
  unknownKeys(value, ["forgeProtocol", "kind", "components", "exclude", "checks", "scenario", "services", "httpClients", "runtime"], diagnostics, "manifest");
  if (value.forgeProtocol !== "2.0" || value.kind !== "repository") diagnostics.push("Repository manifest requires forgeProtocol 2.0 and kind repository");
  const ids = new Set<string>();
  const roots = new Set<string>();
  if (!Array.isArray(value.components) || value.components.length === 0 || value.components.length > 1000) diagnostics.push("components must contain 1..1000 components");
  else for (const component of value.components) {
    if (!object(component)) { diagnostics.push("Invalid component"); continue; }
    unknownKeys(component, ["id", "root", "adapters", "files", "analysis"], diagnostics, "component");
    if (!id(component.id) || ids.has(component.id)) diagnostics.push("Component id invalid or duplicate"); else ids.add(component.id);
    if (!path(component.root)) diagnostics.push("Component root must be a relative contained path");
    else { const canonical = component.root.split("/").filter(part => part && part !== ".").join("/") || "."; const normalized = process.platform === "win32" ? canonical.toLowerCase() : canonical; if (roots.has(normalized)) diagnostics.push("Duplicate component roots"); roots.add(normalized); }
    if (!strings(component.adapters) || component.adapters.length === 0 || new Set(component.adapters).size !== component.adapters.length || component.adapters.some(a => !(REPOSITORY_ADAPTERS as readonly string[]).includes(a))) diagnostics.push("Unsupported or duplicate adapters");
    if (component.files !== undefined && (!strings(component.files) || !component.files.every(path))) diagnostics.push("files must be relative contained paths");
    if (component.analysis !== undefined) {
      if (!object(component.analysis)) diagnostics.push("component analysis must be an object");
      else {
        unknownKeys(component.analysis, ["aliases", "nuxt"], diagnostics, "component analysis");
        if (component.analysis.aliases !== undefined && (!object(component.analysis.aliases) || Object.keys(component.analysis.aliases).length > 100 || !Object.entries(component.analysis.aliases).every(([key, target]) => alias(key) && path(target)))) diagnostics.push("analysis aliases must map bounded names to component-relative contained paths");
        if (component.analysis.nuxt !== undefined) {
          const nuxt = component.analysis.nuxt;
          if (!object(nuxt)) diagnostics.push("analysis nuxt must be an object");
          else {
            unknownKeys(nuxt, ["rootDir", "srcDir", "components", "imports"], diagnostics, "analysis nuxt");
            for (const field of ["rootDir", "srcDir"]) if (nuxt[field] !== undefined && !path(nuxt[field])) diagnostics.push(`nuxt ${field} must be a component-relative contained path`);
            for (const field of ["components", "imports"]) if (nuxt[field] !== undefined && (!paths(nuxt[field]) || (nuxt[field] as string[]).length > 100)) diagnostics.push(`nuxt ${field} must contain at most 100 component-relative paths`);
          }
        }
      }
    }
  }
  if (value.exclude !== undefined && (!strings(value.exclude) || !value.exclude.every(path))) diagnostics.push("exclude must contain relative patterns");
  if (value.services !== undefined && (!strings(value.services) || !value.services.every(path))) diagnostics.push("services must contain relative manifest paths");
  const checks = new Set<string>();
  if (value.checks !== undefined) {
    if (!Array.isArray(value.checks) || value.checks.length > 1000) diagnostics.push("Invalid checks");
    else for (const check of value.checks) {
      if (!object(check)) { diagnostics.push("Invalid check"); continue; }
      unknownKeys(check, ["id", "component", "argv", "cwd", "files", "category", "cost", "requires"], diagnostics, "check");
      if (!id(check.id) || checks.has(check.id)) diagnostics.push("Check id invalid or duplicate"); else checks.add(check.id);
      if (!id(check.component) || !ids.has(check.component)) diagnostics.push("Check refers to unknown component");
      if (!strings(check.argv) || check.argv.length === 0) diagnostics.push("Check argv must be nonempty strings");
      if (check.cwd !== undefined && !path(check.cwd)) diagnostics.push("Check cwd must be a repository-relative contained path");
      if (check.files !== undefined && !paths(check.files)) diagnostics.push("Check files must contain component-relative paths/globs");
      if (check.category !== undefined && !(REPOSITORY_CHECK_CATEGORIES as readonly unknown[]).includes(check.category)) diagnostics.push("Invalid check category");
      if (check.cost !== undefined && !(REPOSITORY_CHECK_COSTS as readonly unknown[]).includes(check.cost)) diagnostics.push("Invalid check cost");
      if (check.requires !== undefined && (!strings(check.requires) || check.requires.length > 32 || !check.requires.every(id) || new Set(check.requires).size !== check.requires.length)) diagnostics.push("Check requires must contain at most 32 unique capability names");
    }
  }
  if (value.httpClients !== undefined) {
    if (!Array.isArray(value.httpClients) || value.httpClients.length > 1000) diagnostics.push("Invalid httpClients");
    else {
      const clients = new Set<string>();
      for (const client of value.httpClients) {
        if (!object(client)) { diagnostics.push("Invalid HTTP client"); continue; }
        unknownKeys(client, ["id", "component", "files", "basePath", "apiComponent"], diagnostics, "HTTP client");
        const key = `${client.component}:${client.id}`;
        if (!clientId(client.id) || clients.has(key)) diagnostics.push("HTTP client id invalid or duplicate within component"); else clients.add(key);
        if (!id(client.component) || !ids.has(client.component)) diagnostics.push("HTTP client refers to unknown component");
        if (client.apiComponent !== undefined && (!id(client.apiComponent) || !ids.has(client.apiComponent))) diagnostics.push("HTTP client refers to unknown API component");
        if (client.files !== undefined && !paths(client.files)) diagnostics.push("HTTP client files must contain component-relative paths/globs");
        if (client.basePath !== undefined && !basePath(client.basePath)) diagnostics.push("HTTP client basePath must be a contained URL path without origin, query or credentials");
      }
    }
  }
  if (value.runtime !== undefined) {
    if (!object(value.runtime)) diagnostics.push("runtime must be an object");
    else {
      unknownKeys(value.runtime, ["observations"], diagnostics, "runtime");
      const observations = value.runtime.observations, observationIds = new Set<string>();
      if (!Array.isArray(observations) || observations.length === 0 || observations.length > 32) diagnostics.push("runtime observations must contain 1..32 observations");
      else for (const observation of observations) {
        if (!object(observation)) { diagnostics.push("Invalid runtime observation"); continue; }
        unknownKeys(observation, ["id", "component", "commands", "artifacts"], diagnostics, "runtime observation");
        if (!id(observation.id) || observationIds.has(observation.id)) diagnostics.push("Runtime observation id invalid or duplicate"); else observationIds.add(observation.id);
        if (!id(observation.component) || !ids.has(observation.component)) diagnostics.push("Runtime observation refers to unknown component");
        if (!Array.isArray(observation.commands) || observation.commands.length === 0 || observation.commands.length > 16) diagnostics.push("Runtime commands must contain 1..16 commands");
        else for (const command of observation.commands) {
          if (!object(command)) { diagnostics.push("Invalid runtime command"); continue; }
          unknownKeys(command, ["argv", "cwd", "timeoutMs"], diagnostics, "runtime command");
          if (!strings(command.argv) || command.argv.length === 0 || command.argv.length > 128 || command.argv.some(arg => /[\u0000-\u001f\u007f]/.test(arg) || /(?:authorization|password|passwd|secret|api[-_]?key|access[-_]?token|client[-_]?secret)(?:=|:)|^--?(?:token|password|passwd|secret|api[-_]?key|access[-_]?token|client[-_]?secret)(?:$|=)|:\/\/[^/\s]+@/i.test(arg))) diagnostics.push("Runtime argv must contain bounded arguments without controls or inline credentials");
          if (command.cwd !== undefined && !path(command.cwd)) diagnostics.push("Runtime cwd must be a repository-relative contained path");
          if (command.timeoutMs !== undefined && (!Number.isInteger(command.timeoutMs) || (command.timeoutMs as number) < 100 || (command.timeoutMs as number) > 120000)) diagnostics.push("Runtime timeoutMs must be 100..120000");
        }
        if (!Array.isArray(observation.artifacts) || observation.artifacts.length === 0 || observation.artifacts.length > 32) diagnostics.push("Runtime artifacts must contain 1..32 artifacts");
        else {
          const artifactPaths = new Set<string>();
          for (const artifact of observation.artifacts) {
            if (!object(artifact)) { diagnostics.push("Invalid runtime artifact"); continue; }
            unknownKeys(artifact, ["path", "format"], diagnostics, "runtime artifact");
            if (!path(artifact.path) || artifact.path.split("/").some(part => /^\.env(?:\.|$)|^\.(?:npmrc|netrc)$|^id_(?:rsa|ed25519)$|credential|secret|private[-_]?key|\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(part)) || artifactPaths.has(artifact.path)) diagnostics.push("Runtime artifact path invalid, sensitive or duplicate"); else artifactPaths.add(artifact.path);
            if (!(REPOSITORY_RUNTIME_ARTIFACT_FORMATS as readonly unknown[]).includes(artifact.format)) diagnostics.push("Invalid runtime artifact format");
          }
        }
      }
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
