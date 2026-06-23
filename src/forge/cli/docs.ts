import { spawnSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { docsReadyNextActions } from "./next-actions.ts";

export type DocsSubcommand = "check";

export interface DocsCheckOptions {
  workspaceRoot: string;
  json: boolean;
  build?: boolean;
  installVenv?: boolean;
}

export interface DocsCheck {
  name: string;
  ok: boolean;
  status: "pass" | "fail" | "warning";
  details?: unknown;
}

export interface DocsCheckResult {
  ok: boolean;
  checks: DocsCheck[];
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

const REQUIRED_DOCS = [
  "index.md",
  "getting-started.md",
  "agent-workflow.md",
  "cli-reference.md",
  "troubleshooting.md",
  "production-readiness.md",
  "self-host.md",
  "release.md",
] as const;

const CONTENT_CHECKS: Array<{ file: string; contains: string[] }> = [
  { file: ".readthedocs.yaml", contains: ["version: 2", "configuration: mkdocs.yml", "fail_on_warning: true", "requirements: docs/requirements.txt"] },
  { file: "mkdocs.yml", contains: ["name: material", "markdown_extensions:", "extra_css:", "javascripts/mermaid-init.js"] },
  { file: "docs/getting-started.md", contains: ["npm create forgeos-app@alpha", "Open the web URL"] },
  { file: "docs/agent-workflow.md", contains: ["forge do", "forge status --json", "forge handoff --json"] },
  { file: "docs/troubleshooting.md", contains: ["FORGE_DELTA_BUSY", "waiting-for-user-trust", "Studio target preview issues"] },
  { file: "docs/release.md", contains: ["release:verify-public-alpha", "Documentation checklist"] },
  { file: "docs/self-host.md", contains: ["forge self-host check"] },
];

function read(workspaceRoot: string, relative: string): string | null {
  const path = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  return nodeFileSystem.readText(path) ?? "";
}

function checkFileExists(workspaceRoot: string, relative: string): DocsCheck {
  return nodeFileSystem.exists(join(workspaceRoot, relative))
    ? { name: relative, ok: true, status: "pass" }
    : { name: relative, ok: false, status: "fail", details: { missing: true } };
}

function checkContains(workspaceRoot: string, file: string, contains: string[]): DocsCheck {
  const content = read(workspaceRoot, file);
  if (content === null) {
    return { name: `${file}:content`, ok: false, status: "fail", details: { missing: true } };
  }
  const missing = contains.filter((needle) => !content.includes(needle));
  return missing.length === 0
    ? { name: `${file}:content`, ok: true, status: "pass" }
    : { name: `${file}:content`, ok: false, status: "fail", details: { missing } };
}

function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function anchorsFor(content: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      anchors.add(slugifyHeading(match[2] ?? ""));
    }
  }
  return anchors;
}

function checkYamlShape(workspaceRoot: string, relative: string, requiredKeys: string[]): DocsCheck {
  const content = read(workspaceRoot, relative);
  if (content === null) {
    return { name: `${relative}:yaml`, ok: false, status: "fail", details: { missing: true } };
  }
  const malformed = content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .filter((line) => !/^\s*-\s+/.test(line))
    .filter((line) => !line.includes(":"));
  const missingKeys = requiredKeys.filter((key) => !new RegExp(`^${key}:`, "m").test(content));
  const ok = malformed.length === 0 && missingKeys.length === 0;
  return ok
    ? { name: `${relative}:yaml`, ok: true, status: "pass" }
    : { name: `${relative}:yaml`, ok: false, status: "fail", details: { malformed, missingKeys } };
}

function checkInternalLinks(workspaceRoot: string): DocsCheck {
  const missing: Array<{ file: string; target: string }> = [];
  const docs = nodeFileSystem.exists(join(workspaceRoot, "docs"))
    ? nodeFileSystem.readDir(join(workspaceRoot, "docs"))
      .filter((entry) => entry.name.endsWith(".md"))
      .map((entry) => `docs/${entry.name}`)
    : [];
  for (const file of docs) {
    const content = read(workspaceRoot, file) ?? "";
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1] ?? "")
      .filter((target) =>
        target &&
        !target.startsWith("http://") &&
        !target.startsWith("https://") &&
        !target.startsWith("mailto:") &&
        !target.startsWith("#") &&
        !target.startsWith("`")
      );
    for (const target of links) {
      const [pathPart, anchor] = target.split("#");
      const resolved = normalize(join(dirname(file), decodeURIComponent(pathPart ?? ""))).replace(/\\/g, "/");
      if (!nodeFileSystem.exists(join(workspaceRoot, resolved))) {
        missing.push({ file, target });
        continue;
      }
      if (anchor) {
        const targetContent = read(workspaceRoot, resolved) ?? "";
        if (!anchorsFor(targetContent).has(anchor)) {
          missing.push({ file, target });
        }
      }
    }
  }
  return missing.length === 0
    ? { name: "docs-internal-links", ok: true, status: "pass" }
    : { name: "docs-internal-links", ok: false, status: "fail", details: { missing } };
}

function checkMkdocsTooling(workspaceRoot: string): DocsCheck {
  const result = spawnSync("python3", ["-m", "mkdocs", "--version"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    return {
      name: "mkdocs-tooling",
      ok: true,
      status: "pass",
      details: { version: (result.stdout ?? "").trim() },
    };
  }
  return {
    name: "mkdocs-tooling",
    ok: true,
    status: "warning",
    details: {
      message: "mkdocs is not importable in the current Python environment; install docs/requirements.txt before building docs locally",
    },
  };
}

function runOptionalDocsBuild(options: DocsCheckOptions): DocsCheck[] {
  const checks: DocsCheck[] = [];
  const python = process.platform === "win32"
    ? join(options.workspaceRoot, ".venv-rtd", "Scripts", "python.exe")
    : join(options.workspaceRoot, ".venv-rtd", "bin", "python");
  if (options.installVenv) {
    const venv = spawnSync("python3", ["-m", "venv", ".venv-rtd"], {
      cwd: options.workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push(venv.status === 0
      ? { name: "mkdocs-venv-create", ok: true, status: "pass" }
      : { name: "mkdocs-venv-create", ok: false, status: "fail", details: { stderr: venv.stderr } });
    if (venv.status === 0) {
      const install = spawnSync(python, ["-m", "pip", "install", "-r", "docs/requirements.txt"], {
        cwd: options.workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      checks.push(install.status === 0
        ? { name: "mkdocs-venv-install", ok: true, status: "pass" }
        : { name: "mkdocs-venv-install", ok: false, status: "fail", details: { stderr: install.stderr } });
    }
  }
  if (options.build) {
    const command = options.installVenv ? python : "python3";
    const args = ["-m", "mkdocs", "build", "--strict"];
    const build = spawnSync(command, args, {
      cwd: options.workspaceRoot,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push(build.status === 0
      ? { name: "mkdocs-build-strict", ok: true, status: "pass", details: { stdout: build.stdout?.trim() } }
      : { name: "mkdocs-build-strict", ok: false, status: "fail", details: { stderr: build.stderr } });
  }
  return checks;
}

export function runDocsCheckCommand(options: DocsCheckOptions): DocsCheckResult {
  const checks: DocsCheck[] = [
    checkFileExists(options.workspaceRoot, ".readthedocs.yaml"),
    checkFileExists(options.workspaceRoot, "mkdocs.yml"),
    checkFileExists(options.workspaceRoot, "docs/requirements.txt"),
    checkFileExists(options.workspaceRoot, "docs/stylesheets/forge.css"),
    checkFileExists(options.workspaceRoot, "docs/javascripts/mermaid-init.js"),
    ...REQUIRED_DOCS.map((file) => checkFileExists(options.workspaceRoot, `docs/${file}`)),
    checkYamlShape(options.workspaceRoot, ".readthedocs.yaml", ["version", "build", "mkdocs"]),
    checkYamlShape(options.workspaceRoot, "mkdocs.yml", ["site_name", "theme", "nav"]),
    ...CONTENT_CHECKS.map((check) => checkContains(options.workspaceRoot, check.file, check.contains)),
    checkInternalLinks(options.workspaceRoot),
    checkMkdocsTooling(options.workspaceRoot),
    ...runOptionalDocsBuild(options),
  ];
  const failed = checks.filter((check) => !check.ok);
  const diagnostics = failed.map((check) => createDiagnostic({
    severity: "error",
    code: "FORGE_DOCS_CHECK_FAILED",
    message: `documentation check failed: ${check.name}`,
    suggestedCommands: ["forge docs check --json", "bun test tests/docs/readthedocs.test.ts"],
  }));
  const ok = failed.length === 0;
  return {
    ok,
    checks,
    diagnostics,
    nextActions: ok
      ? docsReadyNextActions()
      : ["forge docs check --json", "bun test tests/docs/readthedocs.test.ts"],
    exitCode: ok ? 0 : 1,
  };
}

export function formatDocsCheckHuman(result: DocsCheckResult): string {
  const lines = [
    `docs check ${result.ok ? "ok" : "failed"}`,
    ...result.checks.map((check) => `${check.status} ${check.name}`),
  ];
  if (result.nextActions.length > 0) {
    lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  }
  return `${lines.join("\n")}\n`;
}
