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
 * Missing edges, cycles, new advisories and higher severities remain blocking.
 */
export function resolveAuditWaiver(target, name, vulnerabilities, waivers, today = new Date().toISOString().slice(0, 10)) {
  const visit = (packageName, seen) => {
    const vulnerability = vulnerabilities[packageName];
    if (!vulnerability || seen.has(packageName)) return null;
    const explicit = waivers.find(waiver => !waiver.advisory && matches(waiver, target, packageName, vulnerability, today));
    if (explicit) return [explicit]; // Preserve existing explicit whole-package exceptions.
    if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) return null;
    const path = new Set([...seen, packageName]);
    const approvals = [];
    for (const via of vulnerability.via) {
      if (typeof via === "string") {
        const inherited = visit(via, path);
        if (!inherited || inherited.some(waiver => waiver.severity && waiver.severity !== vulnerability.severity)) return null;
        approvals.push(...inherited);
      } else if (via && typeof via === "object") {
        // Each advisory needs its own matching approval, even on the same package.
        const waiver = waivers.find(candidate =>
          matches(candidate, target, packageName, vulnerability, today) &&
          matches(candidate, target, packageName, { ...vulnerability, severity: via.severity ?? vulnerability.severity, via: [via] }, today));
        if (!waiver) return null;
        approvals.push(waiver);
      } else return null;
    }
    return approvals;
  };
  const approved = visit(name, new Set());
  if (!approved?.length) return null;
  return {
    reason: [...new Set(approved.map(waiver => waiver.reason).filter(Boolean))].join("; "),
    advisories: [...new Set(approved.map(waiver => waiver.advisory).filter(Boolean))].sort(),
    expires: approved.every(waiver => waiver.expires) ? approved.map(waiver => waiver.expires).sort()[0] : null,
  };
}
