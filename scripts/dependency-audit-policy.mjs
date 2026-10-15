export function advisoryIds(vulnerability) {
  return (Array.isArray(vulnerability.via) ? vulnerability.via : [])
    .filter(via => via && typeof via === "object")
    .flatMap(via => [via.source, via.url, via.title])
    .filter(value => value !== undefined && value !== null).map(String).sort();
}

export function isExpired(waiver, today = new Date().toISOString().slice(0, 10)) {
  if (!waiver.expires) return false;
  const date = String(waiver.expires);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date < today;
}

function matches(waiver, target, name, vulnerability, today) {
  return !isExpired(waiver, today) &&
    (!waiver.target || waiver.target === target || waiver.target === "all") &&
    (!waiver.package || waiver.package === name) &&
    (!waiver.severity || waiver.severity === vulnerability.severity) &&
    (!waiver.advisory || advisoryIds(vulnerability).includes(String(waiver.advisory)));
}

/** A propagated npm finding is waived only when every underlying advisory is waived.
 * Cycles must be anchored in approved advisories; missing edges, advisory-free
 * components, new advisories and higher severities remain blocking.
 */
export function resolveAuditWaiver(target, name, vulnerabilities, waivers, today = new Date().toISOString().slice(0, 10)) {
  const nodes = new Map();
  const collect = (packageName) => {
    if (nodes.has(packageName)) return true;
    const vulnerability = vulnerabilities[packageName];
    if (!vulnerability) return false;
    const node = { vulnerability, dependencies: [], approvals: new Set() };
    nodes.set(packageName, node);
    const explicit = waivers.find(waiver => !waiver.advisory && matches(waiver, target, packageName, vulnerability, today));
    if (explicit) {
      node.approvals.add(explicit); // Preserve existing explicit whole-package exceptions.
      return true;
    }
    if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) return false;
    for (const via of vulnerability.via) {
      if (typeof via === "string") {
        node.dependencies.push(via);
        if (!collect(via)) return false;
      } else if (via && typeof via === "object") {
        // Each advisory needs its own matching approval, even on the same package.
        const waiver = waivers.find(candidate =>
          matches(candidate, target, packageName, vulnerability, today) &&
          matches(candidate, target, packageName, { ...vulnerability, severity: via.severity ?? vulnerability.severity, via: [via] }, today));
        if (!waiver) return false;
        node.approvals.add(waiver);
      } else return false;
    }
    return true;
  };
  if (!collect(name)) return null;

  // Propagate concrete approvals to a fixed point. A back edge contributes no
  // approval by itself, and a separate unanchored cycle stays empty and blocks.
  let changed;
  do {
    changed = false;
    for (const node of nodes.values()) {
      for (const dependency of node.dependencies) {
        for (const waiver of nodes.get(dependency).approvals) {
          if (!node.approvals.has(waiver)) {
            node.approvals.add(waiver);
            changed = true;
          }
        }
      }
    }
  } while (changed);
  for (const node of nodes.values()) {
    if (!node.approvals.size || [...node.approvals].some(waiver =>
      waiver.severity && waiver.severity !== node.vulnerability.severity)) return null;
  }
  const approved = [...nodes.get(name).approvals];
  return {
    reason: [...new Set(approved.map(waiver => waiver.reason).filter(Boolean))].join("; "),
    advisories: [...new Set(approved.map(waiver => waiver.advisory).filter(Boolean))].sort(),
    expires: approved.every(waiver => waiver.expires) ? approved.map(waiver => waiver.expires).sort()[0] : null,
  };
}

/** Source evidence is produced only by installed-byte verification, never by a waiver file.
 * Reuse the fail-closed graph traversal so every advisory and every cycle anchor
 * needs its own exact, verified source fix. Unknown/empty evidence cannot approve.
 */
export function resolveAuditRemediation(target, name, vulnerabilities, proofs) {
  const exact = proofs.filter(proof => proof.verified === true && proof.target === target &&
    typeof proof.package === "string" && proof.package.length > 0 &&
    typeof proof.advisory === "string" && proof.advisory.startsWith("https://github.com/advisories/") &&
    proof.severity === "high" && typeof proof.integrity === "string" &&
    proof.integrity.startsWith("sha512-") && Array.isArray(proof.instances) && proof.instances.length > 0 &&
    Array.isArray(vulnerabilities[proof.package]?.nodes) && vulnerabilities[proof.package].nodes.length > 0 &&
    vulnerabilities[proof.package].nodes.every(path => proof.instances.some(instance => instance.path === path)));
  const resolved = resolveAuditWaiver(target, name, vulnerabilities, exact);
  if (!resolved) return null;
  return { kind: "verified-source-backport", advisories: resolved.advisories,
    proofs: exact.filter(proof => resolved.advisories.includes(proof.advisory)) };
}

export function validateAuditReport(report, exitCode) {
  if (![0, 1].includes(exitCode) || !report || report.error || report.auditReportVersion !== 2 ||
    !report.vulnerabilities || typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities) ||
    !report.metadata?.vulnerabilities || typeof report.metadata.vulnerabilities !== "object") {
    throw new Error("npm did not return a complete vulnerability report");
  }
  return report;
}
