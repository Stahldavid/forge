import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const { verifyInstalledNuxtBackports } = await import(pathToFileURL(resolve("scripts/verify-nuxt-backports.mjs")).href);
const { resolveAuditRemediation, validateAuditReport } = await import(pathToFileURL(resolve("scripts/dependency-audit-policy.mjs")).href);
const vendor = resolve("templates/nuxt-web/web/vendor");
const manifest = JSON.parse(readFileSync(join(vendor, "backports.json"), "utf8"));
const target = "template:nuxt-web-web";
let project: string;
let proofs: any[];
beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "forge-backport-test-"));
  mkdirSync(join(project, "vendor"));
  for (const pkg of manifest.packages) copyFileSync(join(vendor, pkg.file), join(project, "vendor", pkg.file));
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "forge-backport-tests", private: true,
    dependencies: Object.fromEntries(manifest.packages.map((pkg: any) => [pkg.name, `file:vendor/${pkg.file}`])) }));
  const args = ["install", "--ignore-scripts", "--legacy-peer-deps", "--audit=false", "--fund=false"];
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", `call npm ${args.join(" ")}`], { cwd: project, encoding: "utf8", windowsHide: true })
    : spawnSync("npm", args, { cwd: project, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  proofs = verifyInstalledNuxtBackports(project, target);
}, 120000);
afterAll(() => { if (project) rmSync(project, { recursive: true, force: true }); });

test("installed source and both rebuilt browser bundles reject malformed RSA and preserve ordinary brace/OpenSSL interoperability", () => {
  expect(proofs).toHaveLength(2);
  const forge = proofs.find(proof => proof.package === "node-forge");
  expect(forge.instances[0].sourceChecks).toBe(10);
  expect(forge.instances[0].bundleChecks).toBe(20);
  expect(forge.instances[0].interopChecks).toBe(12);
  expect(proofs.find(proof => proof.package === "braces").instances[0].sourceChecks).toBe(15);
});

test("published vulnerable RSA baseline accepts all four malformed known-key signatures with default padding", () => {
  const script = `import {createRequire} from 'node:module';import{readFileSync}from'node:fs';
const root=process.argv[1],baseline=process.argv[2],vectors=JSON.parse(readFileSync(process.argv[3],'utf8'));
const require=createRequire(root+'/package.json'),forge=require(root+'/lib/index.js');
new Function('require','module','exports',readFileSync(baseline,'utf8'))(createRequire(root+'/lib/rsa.js'),{exports:{}},{});
const key=forge.pki.rsa.setPublicKey(new forge.jsbn.BigInteger(vectors.modulusHex,16),new forge.jsbn.BigInteger('3'));
const digest=forge.md.sha256.create().update(vectors.message).digest().getBytes();
console.log(JSON.stringify(vectors.vectors.map(v=>{try{return key.verify(digest,Buffer.from(v.signatureHex,'hex').toString('binary'));}catch{return false;}})));`;
  const result = spawnSync("node", ["--input-type=module", "-e", script, join(project, "node_modules/node-forge"), resolve("tests/release/fixtures/node-forge-1.4.0-rsa-baseline.cjs"), join(vendor, "security-probes.json")], { encoding: "utf8", timeout: 30000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([true, true, true, true, true]);
});

function altered(path: string, bytes: string | Buffer, check: () => void) {
  const original = readFileSync(path);
  try { writeFileSync(path, bytes); check(); } finally { writeFileSync(path, original); }
}

test("same-version pristine vulnerable RSA bytes cannot inherit a backport proof even if raw audit were empty", () => {
  altered(join(project, "node_modules/node-forge/lib/rsa.js"), readFileSync("tests/release/fixtures/node-forge-1.4.0-rsa-baseline.cjs"), () => {
    expect(() => verifyInstalledNuxtBackports(project, target)).toThrow(/installed bytes mismatch/);
  });
});
test("archive, bundle and lock-path tampering each fail closed", () => {
  const archive = join(project, "vendor", manifest.packages[0].file);
  altered(archive, Buffer.concat([readFileSync(archive), Buffer.from("tamper")]), () => {
    expect(() => verifyInstalledNuxtBackports(project, target)).toThrow(/archive mismatch/);
  });
  altered(join(project, "node_modules/node-forge/dist/forge.min.js"), "tampered", () => {
    expect(() => verifyInstalledNuxtBackports(project, target)).toThrow(/installed bytes mismatch/);
  });
  const lockPath = join(project, "package-lock.json"), lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/node-forge"].resolved = "https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz";
  altered(lockPath, JSON.stringify(lock), () => {
    expect(() => verifyInstalledNuxtBackports(project, target)).toThrow(/non-vendored resolution/);
  });
});
test("a proof covers only exact verified finding paths and advisories", () => {
  const proof = proofs.find(proof => proof.package === "node-forge");
  const graph = { "node-forge": { severity: "high", nodes: ["node_modules/node-forge"], via: [{url: proof.advisory, severity: "high"}] } };
  expect(resolveAuditRemediation(target, "node-forge", graph, proofs)).not.toBeNull();
  graph["node-forge"].nodes = ["node_modules/forge-alias"];
  expect(resolveAuditRemediation(target, "node-forge", graph, proofs)).toBeNull();
  graph["node-forge"].nodes = ["node_modules/node-forge"];
  graph["node-forge"].via.push({ url: "https://github.com/advisories/NEW", severity: "high" });
  expect(resolveAuditRemediation(target, "node-forge", graph, proofs)).toBeNull();
  expect(resolveAuditRemediation("framework", "node-forge", graph, proofs)).toBeNull();
  expect(resolveAuditRemediation(target, "node-forge", graph, [])).toBeNull();
});
test("npm failures or incomplete JSON cannot become a clean report", () => {
  for (const [report, exit] of [[{},1], [{error:{code:"EAUDIT"}},1], [null,0], [{auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{}}},2]])
    expect(() => validateAuditReport(report, exit)).toThrow(/complete vulnerability report/);
  expect(validateAuditReport({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{high:0}}},0)).toBeDefined();
});
test("live waivers are retired; historical expiry tests remain independent", () => {
  expect(JSON.parse(readFileSync("security/dependency-audit-waivers.json", "utf8")).waivers).toEqual([]);
});


test("published Braces baseline accepts excessive string nesting and overflows on an unbounded public AST", () => {
  const script = `import{createRequire}from'node:module';import{readFileSync}from'node:fs';
const root=process.argv[1],fixture=process.argv[2],require=createRequire(root+'/package.json');
const load=name=>{const module={exports:{}};new Function('require','module','exports',readFileSync(fixture+'/braces-3.0.3-'+name+'.cjs','utf8'))(createRequire(root+'/lib/'+name+'.js'),module,module.exports);return module.exports;};
const parse=load('parse'),compile=load('compile');
const ordinary=compile(parse('a/{b,c}/d'));
const excessive=compile(parse('{'.repeat(101)+'a,b'+'}'.repeat(101)));
let ast={type:'text',value:'a'};for(let i=0;i<50000;i++)ast={type:'brace',nodes:[ast]};let overflow=false;try{compile({type:'root',nodes:[ast]});}catch(e){overflow=e instanceof RangeError&&/call stack/i.test(e.message);}
console.log(JSON.stringify({ordinary:typeof ordinary==='string',excessive:typeof excessive==='string',overflow}));`;
  const result = spawnSync("node", ["--input-type=module", "-e", script, join(project,"node_modules/braces"), resolve("tests/release/fixtures")], {encoding:"utf8",timeout:30000});
  expect(result.status,result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ordinary:true,excessive:true,overflow:true});
});

test("changing an installed package identity cannot remove it from verification", () => {
  const path=join(project,"node_modules/node-forge/package.json"),pkg=JSON.parse(readFileSync(path,"utf8"));
  pkg.name="concealed-package";
  altered(path,JSON.stringify(pkg),()=>expect(()=>verifyInstalledNuxtBackports(project,target)).toThrow());
});
