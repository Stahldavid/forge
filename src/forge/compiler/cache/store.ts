import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { PackageApi } from "../types/package-graph.ts";
import type { PackageCacheKey } from "../types/lock.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import {
  buildPackageCacheKey,
  cacheKeysEqual,
  fingerprintPackageCacheKey,
  serializePackageCacheKey,
} from "./key.ts";

export interface CacheEntry {
  key: PackageCacheKey;
  result: PackageApi;
}

export class PackageCacheStore {
  private readonly packagesDir: string;

  constructor(cacheDir: string) {
    this.packagesDir = join(cacheDir, "packages");
    nodeFileSystem.mkdirp(this.packagesDir);
  }

  private entryPath(key: PackageCacheKey): string {
    return join(this.packagesDir, `${fingerprintPackageCacheKey(key)}.json`);
  }

  getWithValidation(
    key: PackageCacheKey,
  ): { hit: PackageApi } | { miss: true } | { corrupt: true } {
    const normalizedKey = buildPackageCacheKey(key);
    const path = this.entryPath(normalizedKey);

    const raw = nodeFileSystem.readText(path);
    if (raw === null) {
      return { miss: true };
    }

    let entry: CacheEntry;
    try {
      entry = JSON.parse(raw) as CacheEntry;
    } catch {
      return { corrupt: true };
    }

    if (!cacheKeysEqual(entry.key, normalizedKey)) {
      return { corrupt: true };
    }

    return { hit: entry.result };
  }

  async put(key: PackageCacheKey, result: PackageApi): Promise<void> {
    const normalizedKey = buildPackageCacheKey(key);
    const path = this.entryPath(normalizedKey);

    const entry: CacheEntry = {
      key: normalizedKey,
      result,
    };

    nodeFileSystem.writeText(path, serializeCacheEntry(entry));
  }

  serializeKey(key: PackageCacheKey): string {
    return serializePackageCacheKey(key);
  }
}

function serializeCacheEntry(entry: CacheEntry): string {
  return `${canonicalJson(entry)}\n`;
}

export function forgeCacheDiscardedMessage(): string {
  return "cache entry was discarded due to read or integrity failure; recomputing analysis";
}
