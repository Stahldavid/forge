#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Runtime identity is independent of the target project: no cwd from runtime config.
const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  let project = process.cwd();
  const index = args.indexOf('--project');
  if (index >= 0) {
    if (!args[index + 1]) throw new Error('--project requires a target directory');
    project = args[index + 1];
    args.splice(index, 2);
  }
  const git = spawnSync('git', ['-C', project, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) throw new Error(`Target must be a Git repository: ${project}`);
  const cwd = realpathSync(git.stdout.trim());
  let runtime = {};
  const config = resolve(skillRoot, 'runtime.json');
  if (existsSync(config)) runtime = JSON.parse(readFileSync(config, 'utf8'));
  let cliPath = process.env.FORGE_FABRIC_CLI || runtime.cliPath;
  if (!cliPath) {
    const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['forge'], { encoding: 'utf8', windowsHide: true });
    const candidates = lookup.stdout?.trim().split(/\r?\n/).filter(Boolean) || [];
    for (const candidate of candidates) {
      const bin = realpathSync(candidate);
      const guesses = [bin, resolve(dirname(bin), 'node_modules/forgeos/bin/forge.mjs')];
      cliPath = guesses.find((path) => path.endsWith('.mjs') && existsSync(path));
      if (cliPath) break;
    }
  }
  if (!cliPath || !isAbsolute(cliPath) || !existsSync(cliPath)) {
    throw new Error('Forge runtime not found. Install this skill with --runtime <absolute forge.mjs>, or set FORGE_FABRIC_CLI to that absolute file.');
  }
  const result = spawnSync(runtime.nodeExecutable || process.execPath, [realpathSync(cliPath), 'fabric', ...args], {
    cwd, stdio: 'inherit', windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
