import type { PackageUpgradePlan } from "./types.ts";

function list(items: string[], empty = "none"): string {
  if (items.length === 0) {
    return `- ${empty}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function renderUpgradePlanMarkdown(plan: PackageUpgradePlan): string {
  const title = `# Package Upgrade Plan: ${plan.packageName} ${plan.from.version} -> ${plan.to.version}`;
  const reasons = plan.risk.reasons.map((reason) => `- ${reason.message}`).join("\n");
  const removed = plan.apiDiff.removedExports.map(
    (change) => `${change.entrypoint}:${change.exportName} (${change.kind})`,
  );
  const added = plan.apiDiff.addedExports.map(
    (change) => `${change.entrypoint}:${change.exportName} (${change.kind})`,
  );
  const signatures = plan.apiDiff.changedSignatures.map(
    (change) =>
      `### ${change.entrypoint}:${change.exportName}\n\nBefore:\n\n\`\`\`ts\n${change.before}\n\`\`\`\n\nAfter:\n\n\`\`\`ts\n${change.after}\n\`\`\``,
  );

  return `${title}

## Summary

Risk: ${plan.risk.level.toUpperCase()} (${plan.risk.score})

Reasons:
${reasons || "- no risk reasons"}

## API Diff

### Removed exports

${list(removed)}

### Added exports

${list(added)}

### Changed signatures

${signatures.length > 0 ? signatures.join("\n\n") : "- none"}

## Affected ForgeOS entries

Files:
${list(plan.affected.files)}

Commands:
${list(plan.affected.commands)}

Queries:
${list(plan.affected.queries)}

Live queries:
${list(plan.affected.liveQueries)}

Actions:
${list(plan.affected.actions)}

Workflows:
${list(plan.affected.workflows)}

Generated adapters:
${list(plan.affected.generatedAdapters)}

## Runtime impact

Contexts now denied:
${list(plan.runtimeDiff.contextsNowDenied)}

Contexts now allowed:
${list(plan.runtimeDiff.contextsNowAllowed)}

Secrets added:
${list(plan.runtimeDiff.secretChanges.added)}

Capabilities added:
${list(plan.runtimeDiff.addedCapabilities.map((capability) => capability.name))}

## Recommended commands

\`\`\`bash
${plan.recommendedCommands.join("\n")}
\`\`\`

## Rollback

\`\`\`bash
forge deps upgrade-rollback ${plan.id}
${plan.rollback.reinstallCommand}
\`\`\`
`;
}
