// Deterministic fixture worker. Does not call an LLM or make network requests.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const role = process.argv[2];
const data = JSON.parse(fs.readFileSync(process.env.FORGE_PROGRAM_INPUT_PATH, 'utf8'));
const context = data.assessmentContext;
const inventory = () => fs.readdirSync('src').filter(name => name.endsWith('.html')).sort().map(name => ({ id: 'src/' + name, allowedPaths: ['src/' + name] }));
const items = data.workItem ? [data.workItem] : inventory();
const invalid = () => items.filter(item => !fs.readFileSync(item.id, 'utf8').includes('data-fixture="good"'));
let result;
if (role === 'discover') result = { items: inventory() };
else if (role === 'implement') {
  for (const item of invalid()) fs.writeFileSync(item.id, fs.readFileSync(item.id, 'utf8').replace('data-fixture="bad"', 'data-fixture="good"'));
  result = { summary: 'Repaired known fixture attributes' };
} else if (role === 'review') {
  const findings = invalid().map(item => ({ itemKey: item.id, reason: 'Known deterministic fixture defect' }));
  result = { verdict: findings.length ? 'changes_requested' : 'approved', findings, coveredObligationIds: context.obligationIds };
} else if (role === 'local-check' || role === 'global-check') result = { passed: invalid().length === 0 };
else if (role === 'capture') {
  // A valid PNG fixture proves artifact transport/binding, not browser rendering.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=', 'base64');
  result = { evidenceArtifacts: items.map((item, index) => {
    const name = 'capture-' + index + '.png', file = path.join(process.env.FORGE_PROGRAM_SCRATCH_DIRECTORY, name);
    const browser = process.argv[3];
    if (browser) {
      const profile = path.join(process.env.FORGE_PROGRAM_SCRATCH_DIRECTORY, 'profile-' + index);
      const rendered = spawnSync(browser, ['--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=800,600', '--user-data-dir=' + profile, '--screenshot=' + file, pathToFileURL(path.resolve(item.id)).href], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
      if (rendered.error || rendered.status !== 0 || !fs.existsSync(file)) throw new Error('Headless browser capture failed');
    } else fs.writeFileSync(file, bytes);
    const image = fs.readFileSync(file), width = image.readUInt32BE(16), height = image.readUInt32BE(20);
    return { path: name, itemKey: item.id, buildDigest: data.candidateDigest, environmentRef: context.environmentRef, mime: 'image/png', width, height, route: '/' + item.id, viewport: width + 'x' + height, state: browser ? 'local-browser-render' : 'deterministic-fixture' };
  }) };
} else throw new Error('Unknown fixture role');
console.log(JSON.stringify(result));
