import { basename, posix } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import type { AdapterResult, AnalysisSource } from "../types.ts";
import { emptyResult, evidence, makeEdge, makeNode } from "./common.ts";

type Data = Record<string, unknown>;
function object(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : typeof value === "string" ? [value] : []; }

export interface ComposeDocument {
  source: AnalysisSource;
  data: Data;
  diagnostics: AdapterResult["diagnostics"];
  serviceLocations: Record<string, { start: number; end: number }>;
}

export function parseCompose(source: AnalysisSource): ComposeDocument {
  const lineCounter = new LineCounter();
  const document = parseDocument(source.text, { uniqueKeys: true, lineCounter, customTags: [] });
  const diagnostics: AdapterResult["diagnostics"] = [];
  const serviceLocations: ComposeDocument["serviceLocations"] = {};
  for (const error of document.errors) diagnostics.push({ code: "REPOSITORY_COMPOSE_PARSE", severity: "error", file: source.path, message: error.code });
  for (const warning of document.warnings) diagnostics.push({ code: "REPOSITORY_COMPOSE_FEATURE", severity: "warning", file: source.path, message: warning.code });
  try {
    const data = document.errors.length ? {} : object(document.toJS({ maxAliasCount: 100 }));
    for (const name of Object.keys(object(data.services))) {
      const node = document.getIn(["services", name], true) as { range?: [number, number, number] } | undefined;
      if (node?.range) serviceLocations[name] = { start: node.range[0], end: node.range[1] };
    }
    return { source, data, diagnostics, serviceLocations };
  }
  catch { diagnostics.push({ code: "REPOSITORY_COMPOSE_ALIAS_LIMIT", severity: "error", file: source.path, message: "Compose aliases exceed safe parsing limit" }); return { source, data: {}, diagnostics, serviceLocations }; }
}

/** Merge supported static fields in scenario order, retaining every file's provenance. */
export function analyzeComposeScenario(documents: ComposeDocument[], profiles: string[] = []): AdapterResult {
  const result = emptyResult();
  const services = new Map<string, { source: AnalysisSource; value: Data; origins: string[]; fieldSources: Record<string, string[]>; location?: { start: number; end: number } }>();
  const networks = new Map<string, AnalysisSource>();
  const volumes = new Map<string, AnalysisSource>();
  for (const document of documents) {
    result.diagnostics.push(...document.diagnostics);
    if (document.data.include !== undefined) result.diagnostics.push({ code: "REPOSITORY_COMPOSE_UNSUPPORTED", severity: "warning", file: document.source.path, message: "Top-level Compose include is not expanded" });
    for (const [name, definition] of Object.entries(object(document.data.services))) {
      const next = object(definition);
      const previous = services.get(name);
      const value = previous ? { ...previous.value, ...next } : next;
      for (const field of ["environment", "labels", "build", "depends_on"] as const) if (typeof previous?.value[field] === "object" && !Array.isArray(previous.value[field]) && typeof next[field] === "object" && !Array.isArray(next[field])) value[field] = { ...object(previous.value[field]), ...object(next[field]) };
      // Known sequences are combined, matching ordinary Compose overlays; special tags remain diagnosed.
      for (const field of ["ports", "volumes", "secrets", "configs", "expose"] as const) if (Array.isArray(previous?.value[field]) && Array.isArray(next[field])) {
        if (JSON.stringify(previous.value[field]) !== JSON.stringify(next[field])) result.diagnostics.push({ code: "REPOSITORY_COMPOSE_OVERLAY_PARTIAL", severity: "warning", file: document.source.path, message: `Service '${name}' overlays '${field}'; entries retained as candidates, full Compose unique-key/target merge not resolved` });
        value[field] = [...new Map([...(previous.value[field] as unknown[]), ...(next[field] as unknown[])].map((item) => [JSON.stringify(item), item])).values()];
      }
      const fieldSources = { ...previous?.fieldSources };
      for (const field of Object.keys(next)) fieldSources[field] = [...new Set([...(previous?.fieldSources[field] ?? []), document.source.path])];
      services.set(name, { source: document.source, value, origins: [...(previous?.origins ?? []), document.source.path], fieldSources, location: document.serviceLocations[name] });
    }
    for (const name of Object.keys(object(document.data.networks))) networks.set(name, document.source);
    for (const name of Object.keys(object(document.data.volumes))) volumes.set(name, document.source);
  }
  const serviceNodes = new Map<string, ReturnType<typeof makeNode>>();
  for (const [name, service] of services) {
    const { source, value, origins, fieldSources, location } = service;
    const declaredProfiles = strings(value.profiles);
    const enabled = !declaredProfiles.length || declaredProfiles.some((profile) => profiles.includes(profile) || profiles.includes("*"));
    const environmentNames = Array.isArray(value.environment) ? strings(value.environment).map((item) => item.split("=")[0]) : Object.keys(object(value.environment));
    const interpolationNames = [...new Set([...JSON.stringify(value).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}/g)].map((match) => match[1]))];
    const build = typeof value.build === "string" ? { context: value.build } : object(value.build);
    const ports = Array.isArray(value.ports) ? value.ports.map((item) => typeof item === "string" || typeof item === "number" ? String(item) : { target: object(item).target, published: object(item).published, protocol: object(item).protocol, host_ip: object(item).host_ip }) : [];
    const node = makeNode(source, "container-service", name, location?.start ?? 0, location?.end ?? 0, {
      scenarioFiles: origins, fieldSources, composeBaseDirectory: documents.length ? posix.dirname(documents[0].source.path) : ".", enabled, profiles: declaredProfiles,
      image: typeof value.image === "string" ? value.image : undefined,
      build: Object.keys(build).length ? { context: build.context, dockerfile: build.dockerfile ?? "Dockerfile", target: build.target } : undefined,
      ports, expose: strings(value.expose), environmentNames, interpolationNames,
      envFiles: strings(value.env_file), secrets: strings(value.secrets).concat(Array.isArray(value.secrets) ? value.secrets.flatMap((item) => typeof object(item).source === "string" ? [String(object(item).source)] : []) : []),
      configs: strings(value.configs), commandDeclared: value.command !== undefined, entrypointDeclared: value.entrypoint !== undefined,
      // No environment values, build args, command bodies, labels or secret payloads are emitted.
      topology: "declared",
    }, `compose-service:${name}`);
    node.evidence = evidence(source, "declared", interpolationNames.length || origins.length > 1 || result.diagnostics.some((diagnostic) => diagnostic.severity !== "info") ? "partial" : "complete");
    result.nodes.push(node); serviceNodes.set(name, node);
    if (interpolationNames.length) result.diagnostics.push({ code: "REPOSITORY_COMPOSE_INTERPOLATION", severity: "info", file: source.path, message: `Service '${name}' references unresolved environment names; no env files/host values read` });
    if (value.extends !== undefined || value.include !== undefined || value.develop !== undefined) result.diagnostics.push({ code: "REPOSITORY_COMPOSE_UNSUPPORTED", severity: "warning", file: source.path, message: `Service '${name}' has configuration not expanded by static analysis` });
  }
  for (const [name, service] of services) {
    const from = serviceNodes.get(name)!;
    const dependencies = Array.isArray(service.value.depends_on) ? strings(service.value.depends_on) : Object.keys(object(service.value.depends_on));
    for (const dependency of dependencies) {
      const to = serviceNodes.get(dependency);
      if (to) result.edges.push(makeEdge(from, to, "depends-on", evidence(service.source, "declared"), { provesTraffic: false, provesAvailability: false }));
      else result.diagnostics.push({ code: "REPOSITORY_COMPOSE_DEPENDENCY_UNRESOLVED", severity: "warning", file: service.source.path, message: `Service '${name}' depends on undeclared '${dependency}'` });
    }
    const serviceNetworks = Array.isArray(service.value.networks) ? strings(service.value.networks) : Object.keys(object(service.value.networks));
    if (!serviceNetworks.length && service.value.network_mode === undefined) serviceNetworks.push("default");
    for (const network of serviceNetworks) {
      if (!networks.has(network)) networks.set(network, service.source);
      const networkNode = makeNode(networks.get(network)!, "network", network, 0, 0, { topology: "declared" }, `compose-network:${network}`);
      if (!result.nodes.some((node) => node.id === networkNode.id)) result.nodes.push(networkNode);
      result.edges.push(makeEdge(from, networkNode, "connects-to", evidence(service.source, "declared"), { provesTraffic: false }));
    }
    for (const volume of strings(service.value.volumes)) {
      const mount = volume.split(":")[0];
      if (volumes.has(mount)) {
        const volumeNode = makeNode(volumes.get(mount)!, "volume", mount, 0, 0, {}, `compose-volume:${mount}`);
        if (!result.nodes.some((node) => node.id === volumeNode.id)) result.nodes.push(volumeNode);
        result.edges.push(makeEdge(from, volumeNode, "mounts", evidence(service.source, "declared")));
      }
    }
  }
  result.limitations.push("Compose: static declared topology; no env values read, no container/runtime observation; extends/include, !reset/!override, interpolation, port reachability and full Compose merge semantics require explicit external resolution");
  return result;
}

export function analyzeDockerfile(source: AnalysisSource): AdapterResult {
  const result = emptyResult();
  let current: ReturnType<typeof makeNode> | undefined;
  let ordinal = 0;
  const stages = new Map<string, ReturnType<typeof makeNode>>();
  const escape = /^#\s*escape\s*=\s*([\\`])\s*$/m.exec(source.text)?.[1] ?? "\\";
  const instructions: { text: string; start: number; end: number }[] = [];
  let position = 0; let continuation: { text: string; start: number; end: number } | undefined;
  const heredocs: string[] = [];
  for (const rawLine of source.text.split(/(?<=\n)/)) {
    const trimmed = rawLine.trim();
    const end = position + rawLine.length;
    if (heredocs.length) {
      if (trimmed === heredocs[0]) heredocs.shift();
      position = end; continue;
    }
    if (!trimmed || trimmed.startsWith("#")) { position = end; continue; }
    const continued = trimmed.endsWith(escape);
    const text = continued ? trimmed.slice(0, -1).trimEnd() : trimmed;
    if (continuation) { continuation.text += ` ${text}`; continuation.end = end; }
    else continuation = { text, start: position, end };
    if (!continued) {
      instructions.push(continuation);
      if (/^(?:RUN|COPY)\s/i.test(continuation.text)) for (const match of continuation.text.matchAll(/<<-?\s*["']?([A-Za-z_][\w]*)["']?/g)) heredocs.push(match[1]);
      if (heredocs.length) result.diagnostics.push({ code: "REPOSITORY_DOCKER_HEREDOC", severity: "info", file: source.path, message: "Heredoc body is excluded from instruction discovery and is not evaluated" });
      continuation = undefined;
    }
    position = end;
  }
  if (continuation) { instructions.push(continuation); result.diagnostics.push({ code: "REPOSITORY_DOCKER_CONTINUATION", severity: "warning", file: source.path, message: "Dockerfile ends in an incomplete continued instruction" }); }
  if (heredocs.length) result.diagnostics.push({ code: "REPOSITORY_DOCKER_HEREDOC", severity: "warning", file: source.path, message: "Dockerfile has an unterminated heredoc" });
  for (const instructionSource of instructions) {
    const line = instructionSource.text;
    const offset = instructionSource.start;
    const match = /^(\w+)\s+([\s\S]*)$/.exec(line);
    if (!match) continue;
    const instruction = match[1].toUpperCase();
    const payload = match[2];
    if (instruction === "FROM") {
      const parts = payload.replace(/^--platform=\S+\s+/, "").split(/\s+/);
      const imageName = parts[0];
      const name = parts.findIndex((part) => part.toUpperCase() === "AS") >= 0 ? parts[parts.findIndex((part) => part.toUpperCase() === "AS") + 1] : `stage-${ordinal}`;
      current = makeNode(source, "build-stage", name, offset, instructionSource.end, { ordinal, image: imageName }, `stage:${name}`);
      current.evidence = evidence(source, "declared"); result.nodes.push(current);
      const prior = stages.get(imageName);
      if (prior) result.edges.push(makeEdge(current, prior, "builds-from", evidence(source, "declared")));
      else {
        const image = makeNode(source, "image", imageName, offset, instructionSource.end, {}, `image:${imageName}`);
        image.evidence = evidence(source, "declared"); result.nodes.push(image); result.edges.push(makeEdge(current, image, "builds-from", evidence(source, "declared")));
      }
      stages.set(name, current); stages.set(String(ordinal++), current);
    } else if (current && instruction === "COPY") {
      const from = /--from=(\S+)/.exec(payload)?.[1];
      if (from && stages.has(from)) result.edges.push(makeEdge(current, stages.get(from)!, "copies-from", evidence(source, "declared")));
      const withoutFlags = payload.replace(/--[\w-]+(?:=\S+)?\s*/g, "");
      let paths: string[] = [];
      if (withoutFlags.startsWith("[")) { try { const value: unknown = JSON.parse(withoutFlags); if (Array.isArray(value)) paths = value.filter((item): item is string => typeof item === "string"); } catch { result.diagnostics.push({ code: "REPOSITORY_DOCKER_COPY_PARSE", severity: "warning", file: source.path, message: "COPY JSON form is invalid or continued across lines" }); } }
      else paths = withoutFlags.split(/\s+/);
      const copy = makeNode(source, "copy-declaration", "COPY", offset, instructionSource.end, { sources: paths.slice(0, -1), destination: paths.at(-1), from }, `copy:${offset}`);
      result.nodes.push(copy); result.edges.push(makeEdge(current, copy, "contains", evidence(source, "declared")));
    } else if (current && ["ENV", "ARG"].includes(instruction)) {
      const names = instruction === "ARG" ? [payload.split(/[=\s]/)[0]] : [...payload.matchAll(/(?:^|\s)([A-Za-z_][\w]*)=/g)].map((match) => match[1]);
      if (!names.length) names.push(payload.split(/\s/)[0]);
      const prior = Array.isArray(current.metadata.environmentNames) ? current.metadata.environmentNames as string[] : [];
      current.metadata.environmentNames = [...new Set([...prior, ...names])];
    } else if (current && instruction === "EXPOSE") current.metadata.expose = payload.split(/\s+/).filter((value) => /^\d+(?:\/(?:tcp|udp))?$/.test(value));
    else if (current && ["CMD", "ENTRYPOINT", "RUN"].includes(instruction)) current.metadata[`${instruction.toLowerCase()}Declared`] = true;
  }
  if (!result.nodes.length) result.diagnostics.push({ code: "REPOSITORY_DOCKER_NO_STAGE", severity: "warning", file: source.path, message: `${basename(source.path)} has no statically recognized FROM stage` });
  result.limitations.push("Dockerfile: declared stages/instructions only; no build, pull, shell evaluation or secret values; heredocs, advanced flags and build argument substitution remain partial");
  return result;
}
