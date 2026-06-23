export function uniqueNextActions(actions: string[]): string[] {
  return [...new Set(actions)].filter(Boolean);
}

export function releasePrepareNextActions(): string[] {
  return ["forge release prepare --env production", "forge release check --json"];
}

export function releaseReadyNextActions(): string[] {
  return ["forge artifacts verify --json", "forge sourcemaps check --json"];
}

export function selfHostPrepareNextActions(): string[] {
  return ["forge self-host compose", "forge self-host env", "forge self-host check --json"];
}

export function selfHostReadyNextActions(): string[] {
  return ["docker compose -f deploy/docker-compose.yml config", "forge release prepare --env production"];
}

export function docsReadyNextActions(): string[] {
  return ["bun test tests/docs/readthedocs.test.ts", "mkdocs build --strict"];
}
