import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { createNoopTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import { loadLiveQueryRegistry } from "./registry.ts";
import { runLiveQuery } from "./live-query-runner.ts";
import type {
  DataChange,
  DataDependency,
  LiveMessage,
  LiveSubscribeInput,
  LiveSubscription,
  LiveSubscriptionManager,
} from "./types.ts";

export interface CreateLiveSubscriptionManagerOptions {
  workspaceRoot: string;
  adapter: DbAdapter;
  loadTableMap: () => Record<string, TableMapEntry>;
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

  async function sendError(
    subscription: LiveSubscription,
    code: string,
    message: string,
    traceId?: string,
  ): Promise<void> {
    subscription.send({
      type: "error",
      subscriptionId: subscription.id,
      error: { code, message, traceId },
    });
    await createNoopTelemetryContext(traceId ?? generateTraceId()).capture(
      "forge.liveQuery.error",
      { name: subscription.name, code },
    );
  }

  async function rerun(subscription: LiveSubscription): Promise<void> {
    const revision = subscription.revision + 1;
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
        String(diagnostic?.code ?? "FORGE_LIVEQUERY_RERUN_FAILED"),
        diagnostic?.message ?? "liveQuery rerun failed",
        result.traceId,
      );
      return;
    }

    subscription.revision = revision;
    subscription.dependencies = result.dependencies;
    index(subscription);
    subscription.send({
      type: "snapshot",
      subscriptionId: subscription.id,
      revision,
      data: result.result,
      traceId: result.traceId,
    });
  }

  return {
    async subscribe(input: LiveSubscribeInput): Promise<LiveSubscription> {
      const id = subscriptionId();
      const result = await runLiveQuery(
        options.workspaceRoot,
        input.name,
        {
          args: input.args,
          auth: input.auth,
          subscriptionId: id,
          revision: 1,
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
        revision: 1,
        dependencies: result.dependencies,
        send: input.send,
      };
      subscriptions.set(id, subscription);

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
      input.send({
        type: "snapshot",
        subscriptionId: id,
        revision: 1,
        data: result.result,
        traceId: result.traceId,
      });
      return subscription;
    },

    async notifyDataChanged(change: DataChange): Promise<void> {
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
          await rerun(subscription);
        }
      }
    },

    unsubscribe(id: string): void {
      const subscription = subscriptions.get(id);
      if (!subscription) {
        return;
      }
      clearIndex(subscription);
      subscriptions.delete(id);
    },

    stats() {
      return {
        subscriptions: subscriptions.size,
        liveQueries: loadLiveQueryRegistry(options.workspaceRoot).liveQueries.length,
      };
    },
  };
}
