import type { PackageApi } from "../types/package-graph.ts";

export interface PackageSignals {
  usesNodeBuiltins: boolean;
  nodeBuiltins: string[];
  usesNetwork: boolean;
  networkEvidence: string[];
  usesFilesystem: boolean;
  filesystemEvidence: string[];
  usesProcess: boolean;
  processEvidence: string[];
  usesEnvSecrets: boolean;
  envSecretEvidence: string[];
  usesNativeAddon: boolean;
  nativeAddonEvidence: string[];
}

const NODE_BUILTIN_PATTERNS = [
  /\bnode:/,
  /\brequire\s*\(\s*["'](?:fs|child_process|net|http|https|dns|tls|os|crypto)["']/,
  /\bfrom\s+["'](?:fs|child_process|net|http|https|dns|tls|os|crypto)["']/,
];

const NETWORK_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bhttp\.request\b/,
  /\bhttps\.request\b/,
  /\bnet\.connect\b/,
  /\baxios\b/,
  /\bgot\b/,
  /\bnode-fetch\b/,
  /\bRequestInit\b/,
  /\bResponse\b/,
];

const FILESYSTEM_PATTERNS = [
  /\bfs\./,
  /\breadFileSync\b/,
  /\bwriteFileSync\b/,
  /\bcreateReadStream\b/,
  /\bcreateWriteStream\b/,
  /\bnode:fs\b/,
];

const PROCESS_PATTERNS = [
  /\bchild_process\b/,
  /\bspawn\s*\(/,
  /\bexec\s*\(/,
  /\bexecFile\s*\(/,
  /\bprocess\.env\b/,
  /\bnode:child_process\b/,
];

const ENV_SECRET_PATTERNS = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
  /\bgetenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];

const NATIVE_ADDON_PATTERNS = [
  /\b\.node\b/,
  /\bnative\b/,
  /\bffi\b/,
  /\bnode-gyp\b/,
];

function collectMatches(text: string, patterns: RegExp[]): string[] {
  const evidence: string[] = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      evidence.push(`pattern:${pattern.source}`);
    }
  }
  return evidence;
}

function collectEnvVars(text: string): string[] {
  const vars = new Set<string>();
  for (const pattern of ENV_SECRET_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      const name = match[1];
      if (name) vars.add(name);
    }
  }
  return [...vars];
}

export function gatherSignals(api: PackageApi): PackageSignals {
  const texts: string[] = [];
  for (const ep of api.entrypoints) {
    for (const exp of ep.exports) {
      texts.push(exp.signature);
      if (exp.overloads) texts.push(...exp.overloads);
      if (exp.declarations) texts.push(...exp.declarations);
      if (exp.jsdoc) {
        texts.push(exp.jsdoc.summary);
        for (const tag of exp.jsdoc.tags) {
          texts.push(`${tag.tag} ${tag.text}`);
        }
      }
    }
  }
  const corpus = texts.join("\n");

  const nodeBuiltins = collectMatches(corpus, NODE_BUILTIN_PATTERNS);
  const networkEvidence = collectMatches(corpus, NETWORK_PATTERNS);
  const filesystemEvidence = collectMatches(corpus, FILESYSTEM_PATTERNS);
  const processEvidence = collectMatches(corpus, PROCESS_PATTERNS);
  const nativeAddonEvidence = collectMatches(corpus, NATIVE_ADDON_PATTERNS);
  const envVars = collectEnvVars(corpus);

  return {
    usesNodeBuiltins: nodeBuiltins.length > 0,
    nodeBuiltins,
    usesNetwork: networkEvidence.length > 0,
    networkEvidence,
    usesFilesystem: filesystemEvidence.length > 0,
    filesystemEvidence,
    usesProcess: processEvidence.length > 0,
    processEvidence,
    usesEnvSecrets: envVars.length > 0,
    envSecretEvidence: envVars.map((v) => `env:${v}`),
    usesNativeAddon: nativeAddonEvidence.length > 0,
    nativeAddonEvidence,
  };
}
