import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { advisoryIds, isExpired, resolveAuditWaiver, resolveAuditRemediation, validateAuditReport } from "./dependency-audit-policy.mjs";

import { verifyInstalledNuxtBackports } from "./verify-nuxt-backports.mjs";

const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const DEFAULT_OUTPUT = "security/evidence/latest/dependency-audit.json";
const DEFAULT_WAIVERS = "security/dependency-audit-waivers.json";

function parseArgs(argv) {
  const positional = [];
  const options = {
    threshold: "high",
    waivers: DEFAULT_WAIVERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--threshold" && argv[index + 1]) {
      options.threshold = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--threshold=")) {
      options.threshold = arg.slice("--threshold=".length);
    } else if (arg === "--waivers" && argv[index + 1]) {
      options.waivers = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--waivers=")) {
      options.waivers = arg.slice("--waivers=".length);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (!(options.threshold in SEVERITY_RANK)) {
    throw new Error(`Unsupported audit threshold '${options.threshold}'.`);
  }

  return {
    outputPath: positional[0] ?? DEFAULT_OUTPUT,
    ...options,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function quoteCmdArg(value) {
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) {
    return value;
  }
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function runNpm(args, cwd) {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", [
      "/d",
      "/c",
      `call ${[npmCommand(), ...args].map(quoteCmdArg).join(" ")}`,
    ], {
      cwd,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
  }

  return spawnSync(npmCommand(), args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

function normalizeDependencies(pkg) {
  const normalizeSpec = (value) => {
    if (value === "__FORGE_PACKAGE_SPEC__") {
      return "npm:forgeos@alpha";
    }
    return value;
  };
  const normalizeEntries = (dependencies) =>
    Object.fromEntries(
      Object.entries(dependencies ?? {})
        .map(([name, version]) => [name, normalizeSpec(version)])
        .sort(([left], [right]) => left.localeCompare(right)),
    );

  return {
    dependencies: normalizeEntries(pkg.dependencies),
    devDependencies: normalizeEntries(pkg.devDependencies),
    ...(pkg.overrides ? { overrides: structuredClone(pkg.overrides) } : {}),
  };
}

function buildTargets() {
  return [
    { name: "framework", manifest: "package.json" },
    { name: "create-forgeos-app", manifest: "packages/create-forge-app/package.json" },
    { name: "template:minimal-web", manifest: "templates/minimal-web/package.json" },
    { name: "template:minimal-web-web", manifest: "templates/minimal-web/web/package.json" },
    { name: "template:nuxt-web", manifest: "templates/nuxt-web/package.json" },
    { name: "template:nuxt-web-web", manifest: "templates/nuxt-web/web/package.json" },
    { name: "template:b2b-support-web", manifest: "templates/b2b-support-web/package.json" },
    { name: "template:b2b-support-web-web", manifest: "templates/b2b-support-web/web/package.json" },
  ].map((target) => ({
    ...target,
    packageJson: readJson(target.manifest),
  }));
}

function readWaivers(path) {
  try {
    const parsed = readJson(path);
    return Array.isArray(parsed.waivers) ? parsed.waivers : [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function summarizeAudit(targetName, audit, waivers, threshold, proofs = []) {
  const vulnerabilities = audit.vulnerabilities ?? {};
  const failures = [];
  const vulnerabilityList = Object.entries(vulnerabilities)
    .map(([packageName, vulnerability]) => {
      const severity = vulnerability.severity ?? "info";
      const failsThreshold = (SEVERITY_RANK[severity] ?? 0) >= SEVERITY_RANK[threshold];
      const remediation = resolveAuditRemediation(targetName, packageName, vulnerabilities, proofs);
      const waiver = remediation ? null : resolveAuditWaiver(targetName, packageName, vulnerabilities, waivers);
      const item = {
        package: packageName,
        severity,
        range: vulnerability.range ?? null,
        fixAvailable: vulnerability.fixAvailable ?? false,
        effects: Array.isArray(vulnerability.effects) ? [...vulnerability.effects].sort() : [],
        advisoryIds: advisoryIds(vulnerability),
        remediated: Boolean(remediation),
        remediation,
        waived: Boolean(waiver),
        waiverReason: waiver?.reason ?? null,
        waiverAdvisories: waiver?.advisories ?? [],
        waiverExpires: waiver?.expires ?? null,
      };
      if (failsThreshold && !waiver && !remediation) {
        failures.push(item);
      }
      return item;
    })
    .sort((left, right) => `${left.severity}:${left.package}`.localeCompare(`${right.severity}:${right.package}`));

  return {
    auditVersion: audit.auditReportVersion ?? null,
    metadata: audit.metadata ?? {},
    vulnerabilities: vulnerabilityList,
    failures,
  };
}

function copyLocalArchives(value, sourceRoot, destinationRoot) {
  if (typeof value === "string" && value.startsWith("file:")) {
    const path = value.slice(5), source = resolve(sourceRoot, path);
    const scoped = relative(sourceRoot, source);
    if (scoped.startsWith("..") || !scoped.endsWith(".tgz")) throw new Error(`Unsupported local audit source: ${value}`);
    const destination = resolve(destinationRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) copyLocalArchives(item, sourceRoot, destinationRoot);
  }
}

function auditBackportIdentities(project, proofs, threshold) {
  const identityRoot = join(project, "registry-identity-audit");
  mkdirSync(identityRoot);
  const source = JSON.parse(readFileSync("templates/nuxt-web/web/vendor/backports.json", "utf8"));
  writeFileSync(join(identityRoot, "package.json"), JSON.stringify({ name: "forge-source-identity-audit", private: true,
    dependencies: Object.fromEntries(source.packages.map(pkg => [pkg.name, pkg.version])) }));
  const install = runNpm(["install", "--package-lock-only", "--ignore-scripts", "--legacy-peer-deps", "--audit=false", "--fund=false"], identityRoot);
  if (install.status !== 0) throw new Error(`Identity audit resolution failed: ${install.stderr}`);
  const result = runNpm(["audit", "--json", "--audit-level", threshold], identityRoot);
  const report = validateAuditReport(JSON.parse(result.stdout), result.status);
  const seen = new Set();
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    for (const advisory of finding.via ?? []) {
      if (!advisory || typeof advisory !== "object") continue;
      const proof = proofs.find(item => item.package === name && item.advisory === advisory.url && item.severity === advisory.severity);
      if (!proof && (SEVERITY_RANK[advisory.severity] ?? 0) >= SEVERITY_RANK[threshold])
        throw new Error(`Unremediated registry identity advisory: ${name} ${advisory.url}`);
      if (proof) seen.add(proof.advisory);
    }
  }
  if (proofs.some(proof => !seen.has(proof.advisory))) throw new Error("Registry identity audit omitted a known advisory; cannot attest coverage");
  return { npmAuditExitCode: result.status, report };
}

function auditTarget(target, tempRoot, waivers, threshold) {
  const tempProject = join(tempRoot, target.name.replace(/[^a-zA-Z0-9._-]/g, "-"));
  mkdirSync(tempProject, { recursive: true });
  const deps = normalizeDependencies(target.packageJson);
  copyLocalArchives(deps, resolve(dirname(target.manifest)), tempProject);
  writeFileSync(
    join(tempProject, "package.json"),
    `${JSON.stringify({
      name: `forge-audit-${target.name.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      private: true,
      type: "module",
      ...deps,
    }, null, 2)}\n`,
    "utf8",
  );

  const install = runNpm(["install", "--package-lock-only", "--ignore-scripts", "--legacy-peer-deps", "--audit=false", "--fund=false"], tempProject);
  if (install.status !== 0) {
    return {
      name: target.name,
      manifest: target.manifest,
      ok: false,
      install: {
        exitCode: install.status ?? 1,
        stdout: install.stdout,
        stderr: install.stderr,
      },
      vulnerabilities: [],
      failures: [
        {
          package: "(install)",
          severity: "critical",
          range: null,
          fixAvailable: false,
          effects: [],
          advisoryIds: [],
          waived: false,
          waiverReason: null,
        },
      ],
    };
  }

  let proofs = [];
  let registryIdentityAudit = null;
  if (target.name === "template:nuxt-web-web") {
    const materialize = runNpm(["install", "--ignore-scripts", "--legacy-peer-deps", "--audit=false", "--fund=false"], tempProject);
    if (materialize.status !== 0) throw new Error(`Cannot materialize Nuxt backports: ${materialize.stderr}`);
    proofs = verifyInstalledNuxtBackports(tempProject, target.name);
    registryIdentityAudit = auditBackportIdentities(tempProject, proofs, threshold);
  }
  const audit = runNpm(["audit", "--json", "--audit-level", threshold], tempProject);
  let parsed;
  try {
    parsed = validateAuditReport(JSON.parse(audit.stdout || "{}"), audit.status);
  } catch {
    return {
      name: target.name,
      manifest: target.manifest,
      ok: false,
      audit: {
        exitCode: audit.status ?? 1,
        stdout: audit.stdout,
        stderr: audit.stderr,
      },
      vulnerabilities: [],
      failures: [
        {
          package: "(audit-json)",
          severity: "critical",
          range: null,
          fixAvailable: false,
          effects: [],
          advisoryIds: [],
          waived: false,
          waiverReason: null,
        },
      ],
    };
  }

  const summary = summarizeAudit(target.name, parsed, waivers, threshold, proofs);
  return {
    name: target.name,
    manifest: target.manifest,
    ok: summary.failures.length === 0,
    npmAuditExitCode: audit.status ?? 0,
    sourceBackportProofs: proofs,
    registryIdentityAudit,
    ...summary,
  };
}

const args = parseArgs(process.argv.slice(2));
const waivers = readWaivers(args.waivers);
const tempRoot = mkdtempSync(join(tmpdir(), "forge-dependency-audit-"));

try {
  const targets = buildTargets().map((target) => auditTarget(target, tempRoot, waivers, args.threshold));
  const failures = targets.flatMap((target) =>
    target.failures.map((failure) => ({
      target: target.name,
      manifest: target.manifest,
      ...failure,
    })),
  );
  const evidence = {
    schemaVersion: "0.1.0",
    kind: "dependency-vulnerability-evidence",
    threshold: args.threshold,
    packageManager: "npm",
    waiverFile: args.waivers,
    waivers: {
      total: waivers.length,
      expired: waivers.filter(waiver => isExpired(waiver)).length,
    },
    summary: {
      ok: failures.length === 0,
      targetCount: targets.length,
      failureCount: failures.length,
    },
    targets,
    failures,
  };

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`wrote dependency audit evidence to ${args.outputPath}`);

  if (failures.length > 0) {
    console.error(`dependency audit found ${failures.length} unwaived issue(s) at or above ${args.threshold}`);
    process.exit(1);
  }
} finally {
  if (process.env.FORGE_KEEP_DEPENDENCY_AUDIT_TEMP !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
