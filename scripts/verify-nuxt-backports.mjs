import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, constants, webcrypto } from "node:crypto";
import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const vendor = resolve(dirname(fileURLToPath(import.meta.url)), "../templates/nuxt-web/web/vendor");
const identities = {
  braces: { version: "3.0.3", advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" },
  "node-forge": { version: "1.4.0", advisory: "https://github.com/advisories/GHSA-86w9-cpqp-85rv" },
};
const json = path => JSON.parse(readFileSync(path, "utf8"));
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");

export function checkRsaVectors(forge, vectors = json(join(vendor, "security-probes.json"))) {
  const key = forge.pki.rsa.setPublicKey(new forge.jsbn.BigInteger(vectors.modulusHex, 16), new forge.jsbn.BigInteger(String(vectors.exponent)));
  const digest = forge.md.sha256.create().update(vectors.message).digest().getBytes();
  let checks = 0;
  for (const vector of vectors.vectors) {
    for (const options of [undefined, {}]) {
      let accepted = false;
      try { accepted = key.verify(digest, Buffer.from(vector.signatureHex, "hex").toString("binary"), undefined, options); } catch { /* malformed signatures must reject */ }
      assert.equal(accepted, vector.valid, vector.name);
      checks++;
    }
  }
  return checks;
}

export function checkBraces(braces) {
  const ordinary = "a/{b,c}/d";
  assert.deepEqual(braces.expand(ordinary), ["a/b/d", "a/c/d"]);
  const boundary = "{".repeat(100) + "a,b" + "}".repeat(100);
  assert.doesNotThrow(() => braces.compile(braces.parse(boundary)));
  const excessive = "{".repeat(101) + "a,b" + "}".repeat(101);
  assert.throws(() => braces(excessive), /exceeds max depth/);
  assert.throws(() => braces("(".repeat(101) + ")".repeat(101)), /exceeds max depth/);
  assert.throws(() => braces.parse("{{a,b},c}", { maxDepth: 1.5 }), /exceeds max depth/);
  assert.throws(() => braces.parse(excessive, { maxDepth: Infinity }), /exceeds max depth/);
  for (const pattern of ["{{a}}", "{a,{b}}", "{{x}y}", "{a,{b,{c}}", "{}{a}"])
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    let ast = { type: "text", value: "a" };
    for (let i = 0; i < 101; i++) ast = { type: "brace", nodes: [ast] };
    assert.throws(() => operation({ type: "root", nodes: [ast] }), /exceeds max depth/);
  }
  const cyclic = { type: "paren", nodes: [{ type: "text", value: "a" }] };
  cyclic.parent = cyclic;
  assert.throws(() => braces.expand(cyclic), /parent chain contains a cycle/);
  return 15;
}

export function runInstalledBackportProbes(name, packageRoot) {
  const require = createRequire(join(packageRoot, "package.json"));
  const entry = require(join(packageRoot, name === "braces" ? "index.js" : "lib/index.js"));
  if (name === "braces") return { sourceChecks: checkBraces(entry), bundleChecks: 0 };
  const sourceChecks = checkRsaVectors(entry);
  let interopChecks = 0;
  for (const exponent of [3, 65537]) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: exponent });
    const key = entry.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }));
    for (const algorithm of ["sha256", "sha384", "sha512"]) {
      const message = Buffer.from("Forge Nuxt backport interoperability");
      const signature = sign(algorithm, message, { key: privateKey, padding: constants.RSA_PKCS1_PADDING }).toString("binary");
      const digest = createHash(algorithm).update(message).digest().toString("binary");
      assert.equal(key.verify(digest, signature), true);
      assert.equal(key.verify(String.fromCharCode(digest.charCodeAt(0) ^ 1) + digest.slice(1), signature), false);
      interopChecks += 2;
    }
  }
  let bundleChecks = 0;
  for (const file of ["forge.min.js", "forge.all.min.js"]) {
    const sandbox = { module: { exports: {} }, exports: {}, crypto: webcrypto, jQuery: Object.freeze({}), setTimeout, clearTimeout, Uint8Array, ArrayBuffer, console };
    sandbox.window = sandbox.self = sandbox;
    runInNewContext(readFileSync(join(packageRoot, "dist", file), "utf8"), sandbox, { timeout: 5000 });
    bundleChecks += checkRsaVectors(sandbox.module.exports);
  }
  return { sourceChecks, interopChecks, bundleChecks };
}

function inventory(root, prefix = "") {
  const files = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    if (!prefix && name === "node_modules") continue; // independently resolved dependencies, not package payload
    const path = join(prefix, name), stat = lstatSync(join(root, path));
    assert.equal(stat.isSymbolicLink(), false, `unexpected package symlink: ${path}`);
    if (stat.isDirectory()) Object.assign(files, inventory(root, path));
    else { assert.equal(stat.isFile(), true); files[path.replaceAll("\\", "/")] = hash(readFileSync(join(root, path))); }
  }
  return files;
}

export function verifyInstalledNuxtBackports(projectRoot, target, vendorRelative = "vendor") {
  assert.ok(["vendor", "web/vendor"].includes(vendorRelative));
  assert.equal(target, "template:nuxt-web-web");
  const manifest = json(join(vendor, "backports.json")), lock = json(join(projectRoot, "package-lock.json"));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.packages.map(x => x.name).sort(), Object.keys(identities).sort());
  const proofs = [];
  for (const backport of manifest.packages) {
    const identity = identities[backport.name];
    assert.equal(backport.version, identity.version); assert.equal(backport.advisory, identity.advisory); assert.equal(backport.severity, "high");
    assert.equal(backport.file, `${backport.name}-${identity.version}-security-backport.tgz`);
    const archive = join(projectRoot, vendorRelative, backport.file);
    assert.equal("sha512-" + createHash("sha512").update(readFileSync(archive)).digest("base64"), backport.integrity, `archive mismatch: ${backport.name}`);
    const instances = Object.entries(lock.packages).filter(([path, metadata]) => {
      if (!path.includes("node_modules/")) return false;
      const file = join(projectRoot, path, "package.json");
      return path === `node_modules/${backport.name}` || path.endsWith(`/node_modules/${backport.name}`) ||
        metadata.name === backport.name || metadata.resolved?.replaceAll("\\", "/") === `file:${vendorRelative}/${backport.file}` ||
        (existsSync(file) && json(file).name === backport.name); // union prevents identity tampering from hiding an instance
    });
    assert.ok(instances.length > 0, `missing resolved instance: ${backport.name}`);
    const verified = [];
    for (const [path, resolved] of instances) {
      assert.equal(resolved.version, identity.version);
      assert.equal(resolved.resolved?.replaceAll("\\", "/"), `file:${vendorRelative}/${backport.file}`, `non-vendored resolution: ${path}`);
      assert.equal(resolved.integrity, backport.integrity, `lock integrity mismatch: ${path}`);
      const root = join(projectRoot, path), pkg = json(join(root, "package.json"));
      assert.equal(pkg.name, backport.name); assert.equal(pkg.version, identity.version);
      assert.deepEqual(inventory(root), backport.files, `installed bytes mismatch: ${path}`);
      verified.push({ path, ...runInstalledBackportProbes(backport.name, root) });
    }
    proofs.push({ verified: true, target, package: backport.name, severity: "high", advisory: backport.advisory, integrity: backport.integrity, patchCommit: backport.patchCommit, instances: verified, reason: "Verified installed source backport, every package file and runtime security probes; raw registry finding retained." });
  }
  return proofs;
}
