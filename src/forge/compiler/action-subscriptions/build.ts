import { createDiagnostic } from "../diagnostics/create.ts";
import { FORGE_ACTION_EVENT_UNPARSEABLE } from "../diagnostics/codes.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  ActionSubscription,
  ActionSubscriptions,
} from "../types/action-subscriptions.ts";
import {
  ACTION_SUBSCRIPTIONS_ANALYZER_VERSION,
  ACTION_SUBSCRIPTIONS_SCHEMA_VERSION,
} from "./constants.ts";
import { parseActionEventFromSlice } from "./parse.ts";

function stableSortSubscriptions(
  subscriptions: ActionSubscription[],
): ActionSubscription[] {
  return [...subscriptions].sort((a, b) => {
    if (a.eventType !== b.eventType) {
      return a.eventType < b.eventType ? -1 : 1;
    }
    if (a.actionName !== b.actionName) {
      return a.actionName < b.actionName ? -1 : 1;
    }
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0;
  });
}

function buildByEvent(
  subscriptions: ActionSubscription[],
): Record<string, ActionSubscription[]> {
  const byEvent: Record<string, ActionSubscription[]> = {};

  for (const subscription of subscriptions) {
    const list = byEvent[subscription.eventType] ?? [];
    list.push(subscription);
    byEvent[subscription.eventType] = list;
  }

  for (const eventType of Object.keys(byEvent).sort()) {
    byEvent[eventType] = stableSortSubscriptions(byEvent[eventType]!);
  }

  return byEvent;
}

export function buildActionSubscriptions(appGraph: AppGraph): ActionSubscriptions {
  const subscriptions: ActionSubscription[] = [];
  const diagnostics: ActionSubscriptions["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "action") {
      continue;
    }

    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    if (sourceSlice.length === 0) {
      continue;
    }

    const eventType = parseActionEventFromSlice(sourceSlice);
    if (eventType === null) {
      if (/event\s*:/.test(sourceSlice)) {
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: FORGE_ACTION_EVENT_UNPARSEABLE,
            message: `cannot parse event subscription for action '${symbol.qualifiedName}'`,
            file: symbol.file,
            span: symbol.span,
          }),
        );
      }
      continue;
    }

    subscriptions.push({
      eventType,
      actionName: symbol.name,
      exportName: symbol.name,
      file: symbol.file,
      symbolId: symbol.id,
    });
  }

  const sorted = stableSortSubscriptions(subscriptions);

  return {
    schemaVersion: ACTION_SUBSCRIPTIONS_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: ACTION_SUBSCRIPTIONS_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: ACTION_SUBSCRIPTIONS_ANALYZER_VERSION,
      }),
    ),
    subscriptions: sorted,
    byEvent: buildByEvent(sorted),
    diagnostics: diagnostics.sort((a, b) => {
      const fileA = a.file ?? "";
      const fileB = b.file ?? "";
      if (fileA !== fileB) {
        return fileA < fileB ? -1 : 1;
      }
      return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
    }),
  };
}
