#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Analysis can target a directory without Git. Runtime configuration never sets cwd.
const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  let project = process.cwd();
  if (args.filter(arg => arg === '--project').length > 1) throw new Error('--project may be supplied only once');
  const index = args.indexOf('--project');
  if (index >= 0) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--project requires a target directory');
    project = args[index + 1];
    args.splice(index, 2);
  }
  const cwd = realpathSync(project);
  if (!statSync(cwd).isDirectory()) throw new Error('Analysis project must be a directory');
  const surface = args.shift();
  if (!['manifest', 'repository', 'cair'].includes(surface)) throw new Error('Choose manifest, repository or cair before the operation');
  if (index >= 0 && (surface === 'repository' || surface === 'cair' || (surface === 'manifest' && args[0] === 'discover')) && !args.includes('--root')) args.push('--root', cwd);
  let runtime = {};
  const config = resolve(skillRoot, 'runtime.json');
  if (existsSync(config)) runtime = JSON.parse(readFileSync(config, 'utf8'));
  let cliPath = process.env.FORGE_FABRIC_CLI || runtime.cliPath;
  if (!cliPath) {
    const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['forge'], { encoding: 'utf8', windowsHide: true });
    for (const candidate of lookup.stdout?.trim().split(/\r?\n/).filter(Boolean) || []) {
      const bin = realpathSync(candidate);
      cliPath = [bin, resolve(dirname(bin), 'node_modules/forgeos/bin/forge.mjs')].find(path => path.endsWith('.mjs') && existsSync(path));
      if (cliPath) break;
    }
  }
  if (!cliPath || !isAbsolute(cliPath) || !existsSync(cliPath)) throw new Error('Forge runtime not found. Install this skill with --runtime <absolute forge.mjs>, or set FORGE_FABRIC_CLI.');
  // No recorder Delta side effects for repository reads; artifacts are explicit analyze outputs.
  const result = spawnSync(runtime.nodeExecutable || process.execPath, [realpathSync(cliPath), surface, ...args, '--no-delta'], { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
