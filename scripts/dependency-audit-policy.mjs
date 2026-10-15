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
