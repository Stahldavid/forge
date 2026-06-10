import type { AuthContext } from "../auth/types.ts";

export interface DataDependency {
  table: string;
  tenantId: string;
}

export interface DataChange {
  tables: string[];
  tenantId: string;
}

export type LiveMessage =
  | {
      type: "snapshot";
      subscriptionId: string;
      revision: number;
      data: unknown;
      traceId?: string;
    }
  | {
      type: "error";
      subscriptionId: string;
      error: {
        code: string;
        message: string;
        traceId?: string;
      };
    };

export interface LiveSubscribeInput {
  name: string;
  args: unknown;
  auth: AuthContext;
  send: (message: LiveMessage) => void;
}

export interface LiveSubscription {
  id: string;
  name: string;
  args: unknown;
  auth: AuthContext;
  revision: number;
  dependencies: DataDependency[];
  send: (message: LiveMessage) => void;
}

export interface LiveSubscriptionManager {
  subscribe(input: LiveSubscribeInput): Promise<LiveSubscription>;
  notifyDataChanged(change: DataChange): Promise<void>;
  unsubscribe(id: string): void;
  stats(): { subscriptions: number; liveQueries: number };
}

export interface WriteTracker {
  changes: DataChange[];
  record(table: string, tenantId: string | null): void;
}
