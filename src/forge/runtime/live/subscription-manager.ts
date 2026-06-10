import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { currentReleaseInfo } from "../release/runtime.ts";
import { createNoopTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import {
  getLatestLiveRevision,
  readLiveInvalidations,
} from "./invalidation-log.ts";
import { loadLiveQueryRegistry } from "./registry.ts";
import { runLiveQuery } from "./live-query-runner.ts";
import type {
  DataChange,
  DataDependency,
  LiveInvalidation,
  LiveMessage,
  LiveProductionLimits,
  LiveSubscribeInput,
  LiveSubscription,
  LiveSubscriptionManager,
} from "./types.ts";
import { DEFAULT_LIVE_LIMITS } from "./types.ts";
import {
  FORGE_AUTH_TOKEN_EXPIRED,
  FORGE_LIVE_BACKPRESSURE_DROPPED_UPDATE,
  FORGE_LIVE_RELEASE_CHANGED,
  FORGE_LIVE_RERUN_FAILED,
  FORGE_LIVE_SNAPSHOT_TOO_LARGE,
  FORGE_LIVE_SUBSCRIPTION_LIMIT,
} from "../../compiler/diagnostics/codes.ts";

export interface CreateLiveSubscriptionManagerOptions {
  workspaceRoot: string;
  adapter: DbAdapter;
  loadTableMap: () => Record<string, TableMapEntry>;
  limits?: Partial<LiveProductionLimits>;
  enablePolling?: boolean;
  pollIntervalMs?: number;
  runtimeId?: string;
}

function subscriptionId(): string {
  return `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function dependencyKey(dependency: DataDependency): string {
  return `${dependency.table}:${dependency.tenantId}`;
}

export function createLiveSubscriptionManager(
  options: CreateLiveSubscriptionManagerOptions,
): LiveSubscriptionManager {
  const subscriptions = new Map<string, LiveSubscription>();
  const dependencyIndex = new Map<string, Set<string>>();
  const pendingReruns = new Map<string, number>();
  const tenantSubscriptionCounts = new Map<string, number>();
  const limits = { ...DEFAULT_LIVE_LIMITS, ...options.limits };
  const runtimeId =
    options.runtimeId ?? `runtime_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const release = currentReleaseInfo();
  let lastSeenRevision = 0;
  let lastProcessedRevision = 0;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  function clearIndex(subscription: LiveSubscription): void {
    for (const dependency of subscription.dependencies) {
      const key = dependencyKey(dependency);
      const ids = dependencyIndex.get(key);
      ids?.delete(subscription.id);
      if (ids?.size === 0) {
        dependencyIndex.delete(key);
      }
    }
  }

  function index(subscription: LiveSubscription): void {
    clearIndex(subscription);
    for (const dependency of subscription.dependencies) {
      const key = dependencyKey(dependency);
      const ids = dependencyIndex.get(key) ?? new Set<string>();
      ids.add(subscription.id);
      dependencyIndex.set(key, ids);
    }
  }

  function tenantKey(subscription: LiveSubscription): string {
    return subscription.auth.kind === "user"
      ? (subscription.auth.tenantId ?? "global")
      : subscription.auth.kind === "system"
        ? (subscription.auth.tenantId ?? "system")
        : "anonymous";
  }

  function countTenant(subscription: LiveSubscription, delta: 1 | -1): void {
    const key = tenantKey(subscription);
    tenantSubscriptionCounts.set(key, Math.max(0, (tenantSubscriptionCounts.get(key) ?? 0) + delta));
  }

  async function sendError(
    subscription: LiveSubscription,
    code: string,
    message: string,
    traceId?: string,
  ): Promise<void> {
    subscription.send({
      type: "error",
      subscriptionId: subscription.id,
      code,
      message,
      traceId,
      retryable: true,
      error: { code, message, traceId },
    });
    await createNoopTelemetryContext(traceId ?? generateTraceId()).capture(
      "forge.liveQuery.error",
      { name: subscription.name, code },
    );
  }

  function isAuthExpired(subscription: LiveSubscription): boolean {
    const expiresAt =
      subscription.auth.kind === "user" ? subscription.auth.token?.expiresAt : undefined;
    return expiresAt !== undefined && Date.now() / 1000 >= expiresAt;
  }

  async function rerun(subscription: LiveSubscription, revision: number): Promise<void> {
    if (subscription.status !== "active") {
      return;
    }

    if (isAuthExpired(subscription)) {
      subscription.status = "closing";
      await sendError(
        subscription,
        FORGE_AUTH_TOKEN_EXPIRED,
        "liveQuery auth token expired",
      );
      subscription.status = "closed";
      return;
    }

    const currentRelease = currentReleaseInfo();
    if (
      subscription.releaseId &&
      currentRelease.releaseId &&
      subscription.releaseId !== currentRelease.releaseId
    ) {
      subscription.send({
        type: "reset",
        subscriptionId: subscription.id,
        reason: "release_changed",
        releaseId: currentRelease.releaseId,
      });
      await sendError(
        subscription,
        FORGE_LIVE_RELEASE_CHANGED,
        "runtime release changed; reconnect liveQuery",
      );
      return;
    }

    const result = await runLiveQuery(
      options.workspaceRoot,
      subscription.name,
      {
        args: subscription.args,
        auth: subscription.auth,
        subscriptionId: subscription.id,
        revision,
        rerun: true,
      },
      {
        adapter: options.adapter,
        tableMap: options.loadTableMap(),
      },
    );

    if (!result.ok) {
      const diagnostic = result.diagnostics.find((entry) => entry.severity === "error");
      await sendError(
        subscription,
        String(diagnostic?.code ?? FORGE_LIVE_RERUN_FAILED),
        diagnostic?.message ?? "liveQuery rerun failed",
        result.traceId,
      );
      return;
    }

    const rowCount = Array.isArray(result.result) ? result.result.length : undefined;
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(result.result)).byteLength;
    if (snapshotBytes > limits.maxSnapshotBytes) {
      await sendError(
        subscription,
        FORGE_LIVE_SNAPSHOT_TOO_LARGE,
        `liveQuery snapshot exceeded ${limits.maxSnapshotBytes} bytes`,
        result.traceId,
      );
      return;
    }

    subscription.revision = revision;
    subscription.lastSentRevision = revision;
    subscription.dependencies = result.dependencies;
    subscription.lastSentAt = new Date().toISOString();
    index(subscription);
    subscription.send({
      type: "snapshot",
      subscriptionId: subscription.id,
      liveQuery: subscription.name,
      revision,
      data: result.result,
      traceId: result.traceId,
      rowCount,
      releaseId: currentRelease.releaseId,
    });
  }

  function invalidationAffectsSubscription(
    invalidation: LiveInvalidation,
    subscription: LiveSubscription,
  ): boolean {
    return subscription.dependencies.some((dependency) => {
      if (dependency.table !== invalidation.tableName) {
        return false;
      }
      return invalidation.tenantId === null || dependency.tenantId === invalidation.tenantId;
    });
  }

  function scheduleRerun(subscriptionId: string, revision: number): void {
    const pending = pendingReruns.get(subscriptionId);
    if (pending !== undefined && pending >= revision) {
      return;
    }
    if (pendingReruns.size > limits.maxPendingMessagesPerSubscription * Math.max(1, subscriptions.size)) {
      const subscription = subscriptions.get(subscriptionId);
      if (subscription) {
        void sendError(
          subscription,
          FORGE_LIVE_BACKPRESSURE_DROPPED_UPDATE,
          "liveQuery update coalesced under backpressure",
        );
      }
    }

    pendingReruns.set(subscriptionId, revision);
    setTimeout(() => {
      const latest = pendingReruns.get(subscriptionId);
      if (latest === undefined) {
        return;
      }
      pendingReruns.delete(subscriptionId);
      const subscription = subscriptions.get(subscriptionId);
      if (subscription) {
        void rerun(subscription, latest);
      }
    }, limits.rerunDebounceMs);
  }

  async function processInvalidations(afterRevision?: number): Promise<number> {
    const startRevision = afterRevision ?? lastSeenRevision;
    const invalidations = await readLiveInvalidations(options.adapter, startRevision);
    if (invalidations.length === 0) {
      return 0;
    }

    let processed = 0;
    for (const invalidation of invalidations) {
      lastSeenRevision = Math.max(lastSeenRevision, invalidation.revision);
      for (const subscription of subscriptions.values()) {
        if (invalidationAffectsSubscription(invalidation, subscription)) {
          scheduleRerun(subscription.id, invalidation.revision);
        }
      }
      lastProcessedRevision = invalidation.revision;
      processed += 1;
    }
    return processed;
  }

  if (options.enablePolling) {
    const interval = options.pollIntervalMs ?? 1_000;
    pollingTimer = setInterval(() => {
      void processInvalidations().catch(() => undefined);
    }, interval);
    (pollingTimer as { unref?: () => void }).unref?.();
    void getLatestLiveRevision(options.adapter).then((revision) => {
      lastSeenRevision = revision;
      lastProcessedRevision = revision;
    }).catch(() => undefined);
  }

  return {
    async subscribe(input: LiveSubscribeInput): Promise<LiveSubscription> {
      if (subscriptions.size >= limits.maxSubscriptionsPerClient) {
        const id = subscriptionId();
        input.send({
          type: "error",
          subscriptionId: id,
          code: FORGE_LIVE_SUBSCRIPTION_LIMIT,
          message: "liveQuery subscription limit reached",
          retryable: false,
          error: {
            code: FORGE_LIVE_SUBSCRIPTION_LIMIT,
            message: "liveQuery subscription limit reached",
          },
        });
        throw new Error(FORGE_LIVE_SUBSCRIPTION_LIMIT);
      }

      const id = subscriptionId();
      const currentRevision = await getLatestLiveRevision(options.adapter);
      const initialRevision = Math.max(1, input.lastRevision ?? currentRevision);
      const result = await runLiveQuery(
        options.workspaceRoot,
        input.name,
        {
          args: input.args,
          auth: input.auth,
          subscriptionId: id,
          revision: initialRevision,
        },
        {
          adapter: options.adapter,
          tableMap: options.loadTableMap(),
        },
      );

      const subscription: LiveSubscription = {
        id,
        name: input.name,
        args: input.args,
        auth: input.auth,
        revision: initialRevision,
        lastSentRevision: initialRevision,
        dependencies: result.dependencies,
        status: "active",
        createdAt: new Date().toISOString(),
        releaseId: release.releaseId,
        send: input.send,
      };
      subscriptions.set(id, subscription);
      countTenant(subscription, 1);

      if (!result.ok) {
        const diagnostic = result.diagnostics.find((entry) => entry.severity === "error");
        input.send({
          type: "error",
          subscriptionId: id,
          error: {
            code: String(diagnostic?.code ?? "FORGE_LIVEQUERY_SUBSCRIPTION_FAILED"),
            message: diagnostic?.message ?? "liveQuery subscription failed",
            traceId: result.traceId,
          },
        });
        return subscription;
      }

      index(subscription);
      const rowCount = Array.isArray(result.result) ? result.result.length : undefined;
      input.send({
        type: "snapshot",
        subscriptionId: id,
        liveQuery: input.name,
        revision: initialRevision,
        data: result.result,
        traceId: result.traceId,
        rowCount,
        releaseId: release.releaseId,
      });
      return subscription;
    },

    async notifyDataChanged(change: DataChange): Promise<void> {
      if (change.revision !== undefined) {
        await processInvalidations(change.revision - 1);
        return;
      }
      const affected = new Set<string>();
      for (const table of change.tables) {
        const ids = dependencyIndex.get(`${table}:${change.tenantId}`);
        for (const id of ids ?? []) {
          affected.add(id);
        }
      }

      for (const id of affected) {
        const subscription = subscriptions.get(id);
        if (subscription) {
          await rerun(subscription, subscription.lastSentRevision + 1);
        }
      }
    },

    processInvalidationsSince: processInvalidations,

    unsubscribe(id: string): void {
      const subscription = subscriptions.get(id);
      if (!subscription) {
        return;
      }
      subscription.status = "closed";
      clearIndex(subscription);
      subscriptions.delete(id);
      countTenant(subscription, -1);
    },

    debug(id: string): LiveSubscription | null {
      return subscriptions.get(id) ?? null;
    },

    status() {
      return {
        runtime: {
          id: runtimeId,
          transport: "sse",
          subscriptions: subscriptions.size,
        },
        invalidation: {
          lastSeenRevision,
          lastProcessedRevision,
          polling: options.enablePolling ?? false,
          postgresNotify: true,
        },
        limits,
      };
    },

    stats() {
      return {
        subscriptions: subscriptions.size,
        liveQueries: loadLiveQueryRegistry(options.workspaceRoot).liveQueries.length,
        lastRevision: lastProcessedRevision,
      };
    },

    stop() {
      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }
    },
  };
}
