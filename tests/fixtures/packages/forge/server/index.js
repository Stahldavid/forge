export function command(fnOrConfig) {
  if (typeof fnOrConfig === "function") {
    fnOrConfig.__forge = { kind: "command" };
    return fnOrConfig;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "command",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export function action(fnOrConfig) {
  if (typeof fnOrConfig === "function") {
    fnOrConfig.__forge = { kind: "action" };
    return fnOrConfig;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "action",
      ...(fnOrConfig.event !== undefined ? { event: fnOrConfig.event } : {}),
      ...(fnOrConfig.auth !== undefined ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export function event(eventType) {
  return { type: "event", eventType };
}

export function step(name, handler) {
  return { name, handler };
}

export function workflow(config) {
  return {
    ...config,
    __forge: { kind: "workflow" },
  };
}

export function aiTool(config) {
  return {
    ...config,
    __forge: { kind: "aiTool" },
  };
}

export function agent(config) {
  return {
    ...config,
    __forge: { kind: "agent" },
  };
}

export function query(fnOrConfig) {
  if (typeof fnOrConfig === "function") {
    fnOrConfig.__forge = { kind: "query" };
    return fnOrConfig;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "query",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export function liveQuery(fnOrConfig) {
  if (typeof fnOrConfig === "function") {
    fnOrConfig.__forge = { kind: "liveQuery" };
    return fnOrConfig;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "liveQuery",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export { defineTable } from "../schema/index.js";
export { can, canRole, definePolicies, public_, system } from "../policy/index.js";
