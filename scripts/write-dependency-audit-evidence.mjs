import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

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

function advisoryIds(vulnerability) {
  return (Array.isArray(vulnerability.via) ? vulnerability.via : [])
    .filter((via) => via && typeof via === "object")
    .flatMap((via) => [via.source, via.url, via.title])
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .sort();
}

function isExpired(waiver) {
  if (!waiver.expires) {
    return false;
  }
  return String(waiver.expires) < new Date().toISOString().slice(0, 10);
}

function matchesWaiver(waiver, targetName, packageName, vulnerability) {
  if (isExpired(waiver)) {
    return false;
  }
  if (waiver.target && waiver.target !== targetName && waiver.target !== "all") {
    return false;
  }
  if (waiver.package && waiver.package !== packageName) {
    return false;
  }
  if (waiver.severity && waiver.severity !== vulnerability.severity) {
    return false;
  }
  if (waiver.advisory) {
    return advisoryIds(vulnerability).includes(String(waiver.advisory));
  }
  return true;
}

function summarizeAudit(targetName, audit, waivers, threshold) {
  const vulnerabilities = audit.vulnerabilities ?? {};
  const failures = [];
  const vulnerabilityList = Object.entries(vulnerabilities)
    .map(([packageName, vulnerability]) => {
      const severity = vulnerability.severity ?? "info";
      const failsThreshold = (SEVERITY_RANK[severity] ?? 0) >= SEVERITY_RANK[threshold];
      const waiver = waivers.find((candidate) => matchesWaiver(candidate, targetName, packageName, vulnerability));
      const item = {
        package: packageName,
        severity,
        range: vulnerability.range ?? null,
        fixAvailable: vulnerability.fixAvailable ?? false,
        effects: Array.isArray(vulnerability.effects) ? [...vulnerability.effects].sort() : [],
        advisoryIds: advisoryIds(vulnerability),
        waived: Boolean(waiver),
        waiverReason: waiver?.reason ?? null,
      };
      if (failsThreshold && !waiver) {
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

function auditTarget(target, tempRoot, waivers, threshold) {
  const tempProject = join(tempRoot, target.name.replace(/[^a-zA-Z0-9._-]/g, "-"));
  mkdirSync(tempProject, { recursive: true });
  const deps = normalizeDependencies(target.packageJson);
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

  const install = runNpm(["install", "--package-lock-only", "--ignore-scripts", "--audit=false", "--fund=false"], tempProject);
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

  const audit = runNpm(["audit", "--json", "--audit-level", threshold], tempProject);
  let parsed;
  try {
    parsed = JSON.parse(audit.stdout || "{}");
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

  const summary = summarizeAudit(target.name, parsed, waivers, threshold);
  return {
    name: target.name,
    manifest: target.manifest,
    ok: summary.failures.length === 0,
    npmAuditExitCode: audit.status ?? 0,
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
      expired: waivers.filter(isExpired).length,
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
