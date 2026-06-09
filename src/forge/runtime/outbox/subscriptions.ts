import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionSubscription } from "../../compiler/types/action-subscriptions.ts";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";

interface ActionSubscriptionsJson {
  subscriptions: ActionSubscription[];
  byEvent: Record<string, ActionSubscription[]>;
}

export function loadActionSubscriptions(
  workspaceRoot: string,
): ActionSubscriptionsJson {
  const absolute = join(workspaceRoot, GENERATED_DIR, "actionSubscriptions.json");
  if (!existsSync(absolute)) {
    return { subscriptions: [], byEvent: {} };
  }

  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  const parsed = JSON.parse(raw) as ActionSubscriptionsJson;
  return {
    subscriptions: parsed.subscriptions ?? [],
    byEvent: parsed.byEvent ?? {},
  };
}

export function subscriptionsForEvent(
  subscriptions: ActionSubscription[],
  eventType: string,
): ActionSubscription[] {
  return subscriptions.filter((subscription) => subscription.eventType === eventType);
}
