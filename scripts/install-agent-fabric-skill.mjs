#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function sourceInventory(directory) {
  const files = [];
  function visit(base, relative = '') {
    for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!relative && ['runtime.json', 'installation.json'].includes(entry.name)) continue;
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(resolve(base, entry.name), name);
      else files.push(name.slice(1));
    }
  }
  visit(directory);
  return files;
}
function sourceDigest(directory, inventory) {
  const hash = createHash('sha256');
  for (const name of inventory) {
    const file = resolve(directory, name);
    try {
      const stat = lstatSync(file);
      hash.update(JSON.stringify([name, stat.isSymbolicLink() ? 'link' : 'file']));
      hash.update(stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file));
    } catch { return null; }
  }
  return hash.digest('hex');
}
function canonicalPath(path) {
  try { return realpathSync(path); } catch {
    const parent = dirname(path);
    if (parent === path) throw new Error(`Cannot resolve destination: ${path}`);
    return resolve(canonicalPath(parent), basename(path));
  }
}
try {
  const args = process.argv.slice(2);
  const known = new Set(['--dest', '--runtime', '--dry-run', '--replace', '--help']);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!known.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (flag === '--dest' || flag === '--runtime') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${flag} requires a path`);
      options[flag] = args[++index];
    } else options[flag] = true;
  }
  if (options['--help']) {
    process.stdout.write('Install portable Agent Fabric skill: --dest <skills-root> --runtime <forge.mjs> --dry-run --replace\nDefaults: ~/.agents/skills and this package runtime. No MCP or hooks are configured.\n');
  } else {
    const source = resolve(packageRoot, '.agents/skills/forge-agent-fabric');
    const skillsRoot = resolve(options['--dest'] || resolve(homedir(), '.agents/skills'));
    const target = resolve(skillsRoot, 'forge-agent-fabric');
    const runtime = realpathSync(resolve(options['--runtime'] || resolve(packageRoot, 'bin/forge.mjs')));
    const marker = resolve(target, 'installation.json');
    let installed = {};
    let owned = false;
    if (existsSync(marker)) {
      try { installed = JSON.parse(readFileSync(marker, 'utf8')); owned = installed.installer === 'forgeos-agent-fabric-skill'; } catch {}
    }
    if (existsSync(target) && !owned && !options['--replace']) {
      throw new Error(`Existing skill is not managed by this installer: ${target}. Review it and use --replace to preserve a backup and replace it.`);
    }
    const normalize = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
    const canonicalSource = normalize(canonicalPath(source));
    const canonicalTarget = normalize(canonicalPath(target));
    if (canonicalTarget === canonicalSource || canonicalTarget.startsWith(`${canonicalSource}${sep}`) || canonicalSource.startsWith(`${canonicalTarget}${sep}`)) {
      throw new Error('Installation destination must differ from the packaged source skill.');
    }
    const inventory = sourceInventory(source);
    const digest = sourceDigest(source, inventory);
    if (!digest) throw new Error('Packaged skill contains unreadable source files.');
    let existingRuntime = {};
    try { existingRuntime = JSON.parse(readFileSync(resolve(target, 'runtime.json'), 'utf8')); } catch {}
    const unchanged = owned && installed.sourceDigest === digest && sourceDigest(target, inventory) === digest && existingRuntime.cliPath === runtime && existingRuntime.nodeExecutable === process.execPath;
    const result = { target, cliPath: runtime, nodeExecutable: process.execPath, dryRun: !!options['--dry-run'], replacesExisting: existsSync(target), unchanged };
    if (!options['--dry-run'] && !unchanged) {
      // Stage outside the discovery root so incomplete or backup copies are not skills.
      const stagingRoot = resolve(dirname(skillsRoot), 'skill-backups');
      mkdirSync(stagingRoot, { recursive: true });
      const staged = resolve(stagingRoot, `forge-agent-fabric-stage-${randomUUID()}`);
      cpSync(source, staged, { recursive: true, verbatimSymlinks: true });
      writeFileSync(resolve(staged, 'runtime.json'), `${JSON.stringify({ cliPath: runtime, nodeExecutable: process.execPath }, null, 2)}\n`);
      writeFileSync(resolve(staged, 'installation.json'), `${JSON.stringify({ installer: 'forgeos-agent-fabric-skill', version: 1, sourceDigest: digest }, null, 2)}\n`);
      mkdirSync(skillsRoot, { recursive: true });
      if (existsSync(target)) {
        result.backup = resolve(stagingRoot, `forge-agent-fabric-backup-${randomUUID()}`);
        renameSync(target, result.backup);
      }
      try { renameSync(staged, target); } catch (error) {
        if (result.backup && !existsSync(target)) renameSync(result.backup, target);
        throw error;
      }
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
