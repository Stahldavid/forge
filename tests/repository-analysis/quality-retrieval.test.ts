import { describe, expect, test } from "bun:test";
import { queryRepository } from "../../src/forge/repository-analysis/context.ts";
import { groupRepositoryJavaCalls, normalizeRepositoryTerms, rankRepositoryCandidates, selectRepositoryContext } from "../../src/forge/repository-analysis/retrieval.ts";
import type { RepositoryEdge, RepositoryNode, RepositorySnapshot } from "../../src/forge/repository-analysis/types.ts";

const evidence = { assurance: "resolved" as const, resolution: "complete" as const, adapter: "typescript", version: "quality-fixture" };
function node(id: string, name: string, file: string, kind = "symbol", metadata: Record<string, unknown> = {}): RepositoryNode {
  return { id, name, file, kind, component: "application", evidence, metadata };
}
function edge(id: string, from: string, to: string, kind: string): RepositoryEdge {
  return { id, from, to, kind, evidence, metadata: { binding: "static-import", runtimeRoutingVerified: false } };
}
function fixture(): RepositorySnapshot {
  return { schemaVersion: 1, provider: "repository", snapshotId: "quality-snapshot", root: "/fixture", manifestHash: "", scenarioHash: "", createdAt: "", files: {},
    manifest: { forgeProtocol: "2.0", kind: "repository", components: [{ id: "application", root: ".", adapters: ["typescript", "java"] }] },
    nodes: [node("service", "deleteCustomer", "api/customers.ts", "symbol", { qualifiedName: "CustomerService.deleteCustomer" }),
      node("controller", "removeCustomerHandler", "api/controller.ts"), node("page", "CustomerPage", "web/Customers.vue", "ui-component"),
      node("test", "removes customer", "tests/customer.test.ts", "test"), node("unrelated", "calculates price", "tests/customer.test.ts", "test"),
      node("login", "authenticateUser", "api/auth.ts"), node("file", "api/customers.ts", "api/customers.ts", "file")],
    edges: [edge("consumer", "controller", "service", "calls"), edge("ui", "page", "controller", "references"),
      edge("precise-test", "test", "service", "test-exercises")],
    coverage: { found: 7, analyzed: 7, ignored: 0, unsupported: 0, errors: 0, reused: 0, limitations: [], diagnostics: [], ignoredPaths: [] } };
}

describe("deterministic repository retrieval quality", () => {
  test("Portuguese instructions and camelCase locate the useful English symbols", () => {
    const snapshot = fixture();
    expect(normalizeRepositoryTerms("UserHTTPClient Autenticação")).toEqual(["user", "http", "client", "autenticacao"]);
    const candidates = rankRepositoryCandidates(snapshot, "Por favor corrija a exclusão de clientes");
    expect(candidates[0]?.node.id).toBe("service");
    expect(candidates[0]?.selectionReasons.join()).toContain("matched-terms");
    expect(queryRepository(snapshot, "melhore autenticação de usuários").items.some(item => item.id === "login")).toBe(true);
    expect(rankRepositoryCandidates(snapshot, "Update CustomerService.deleteCustomer")[0]?.node.id).toBe("service");
    expect(queryRepository(snapshot, "locate service").items.map(item => item.id)).toEqual(["service"]);
  });
  test("scope stays fixed while consumers and precise tests are included as read-only context", () => {
    const snapshot = fixture();
    const scope = ["api/customers.ts"];
    const packet = selectRepositoryContext(snapshot, "Fix deleteCustomer", { writeScope: scope, maxChars: 10000 });
    expect(packet.writeScope).toEqual(scope);
    expect(packet.nodes.find(node => node.id === "service")?.access).toBe("write-scope");
    expect(packet.nodes.find(node => node.id === "controller")?.access).toBe("read-only");
    expect(packet.nodes.find(node => node.id === "test")?.access).toBe("read-only");
    expect(packet.nodes.some(node => node.id === "unrelated")).toBe(false);
    expect(packet.groups.find(group => group.subject === "service")?.tests).toEqual(["test"]);
    expect(packet.groups.find(group => group.subject === "service")?.consumers).toContain("controller");
    expect(packet.nodes.find(node => node.id === "service")?.metadata.qualifiedName).toBe("CustomerService.deleteCustomer");
    expect(packet.edges[0]?.metadata.runtimeRoutingVerified).toBe(false);
    expect(scope).toEqual(["api/customers.ts"]);
  });
  test("general Portuguese domain terms locate English declarations and vice versa", () => {
    const snapshot = fixture();
    snapshot.nodes.push(node("booking", "scheduleBooking", "api/booking.ts"),
      node("validation", "validateCategory", "api/categories.ts"), node("staging", "stagingEnvironment", "infra/staging.ts"),
      node("portuguese", "validarAgendamento", "api/agendamento.ts"));
    expect(rankRepositoryCandidates(snapshot, "corrija agendamentos")[0]?.node.id).toBe("booking");
    expect(rankRepositoryCandidates(snapshot, "melhore validacao categoria")[0]?.node.id).toBe("validation");
    expect(rankRepositoryCandidates(snapshot, "ajuste homologação")[0]?.node.id).toBe("staging");
    expect(rankRepositoryCandidates(snapshot, "fix booking validation").some(candidate => candidate.node.id === "portuguese")).toBe(true);
  });
  test("exported declarations retain consumers and precise tests ahead of local-variable noise", () => {
    const snapshot = fixture();
    const service = snapshot.nodes.find(node => node.id === "service")!;
    service.metadata = { exported: true, symbolKind: "FunctionDeclaration" };
    for (let i = 0; i < 30; i++) snapshot.nodes.push(node(`local${i}`, `customer${i}`, service.file!, "symbol", { symbolKind: "VariableDeclaration" }));
    snapshot.nodes.push(node("suite-node", "delete customer", "tests/customer.test.ts", "test-suite"));
    snapshot.edges.push(edge("suite-edge", "suite-node", "service", "test-references"));
    const options = { writeScope: [service.file!], maxNodes: 10, maxChars: 10000 };
    const ranked = rankRepositoryCandidates(snapshot, "customer", options);
    expect(ranked[0]?.node.id).toBe("service");
    expect(ranked[0]?.selectionReasons).toContain("exported-declaration");
    const packet = selectRepositoryContext(snapshot, "customer", options);
    expect(packet.nodes.some(node => node.id === "controller" && node.access === "read-only")).toBe(true);
    expect(packet.nodes.some(node => node.id === "test" && node.access === "read-only")).toBe(true);
    expect(packet.nodes.some(node => node.id === "suite-node" || node.id === "unrelated")).toBe(false);
    expect(packet.groups.find(group => group.subject === "service")?.tests).toEqual(["test"]);
  });
  test("an exact declaration does not expand lexical generic verbs into another feature", () => {
    const snapshot = fixture();
    snapshot.nodes.push(node("seo", "validateSeoEnvironment", "web/seo.ts"),
      node("checkout", "validateCheckoutPayment", "web/checkout.ts"), node("seo-test", "checks SEO", "tests/shared.ts", "test"),
      node("checkout-test", "checkout payment", "tests/shared.ts", "test"));
    snapshot.edges.push(edge("seo-case", "seo-test", "seo", "test-exercises"), edge("checkout-case", "checkout-test", "checkout", "test-exercises"));
    const exact = selectRepositoryContext(snapshot, "fix validateSeoEnvironment");
    expect(exact.nodes.some(node => node.id === "seo-test")).toBe(true);
    expect(exact.nodes.some(node => node.id === "checkout" || node.id === "checkout-test")).toBe(false);
    const natural = selectRepositoryContext(snapshot, "corrigir validação SEO");
    expect(natural.nodes.some(node => node.id === "seo-test")).toBe(true);
    expect(natural.nodes.some(node => node.id === "checkout" || node.id === "checkout-test")).toBe(false);
  });
  test("two bounded control-flow hops include static HTTP targets without crossing test-file imports", () => {
    const snapshot = fixture();
    snapshot.nodes.push(node("loader", "loadScheduleBooking", "web/http.ts"),
      node("http", "GET /schedule", "web/http.ts", "http-call"), node("api", "GET /schedule", "api/Schedule.java", "endpoint"),
      node("test-file", "tests/shared.ts", "tests/shared.ts", "file"));
    snapshot.edges.push(edge("load-http", "loader", "http", "calls"), edge("http-api", "http", "api", "calls"),
      edge("shared-file", "test-file", "loader", "test-file-depends-on"), edge("unrelated-import", "test-file", "login", "imports"));
    const packet = selectRepositoryContext(snapshot, "loadScheduleBooking", { writeScope: ["web/http.ts"], maxNodes: 5 });
    expect(packet.nodes.some(node => node.id === "api" && node.access === "read-only")).toBe(true);
    expect(packet.nodes.some(node => node.id === "login")).toBe(false);
    expect(packet.edges.some(edge => edge.id === "http-api")).toBe(true);
    expect(packet.nodes.find(node => node.id === "api")?.selectionReasons).toContain("graph-depth:2");
  });
  test("a scoped natural-language task retains its consumer and exact case amid dense local facts", () => {
    const snapshot = fixture();
    const file = "web/seoEnvironment.ts";
    snapshot.nodes.push(node("seo", "validateSeoEnvironment", file, "symbol", { exported: true, symbolKind: "VariableDeclaration" }),
      node("config", "seoViolations", "web/nuxt.config.ts"), node("seo-case", "SEO remains noindex in homologation", "tests/shared.ts", "test"),
      node("backend-noise", "pixHomologationCannotBeClaimedBeforeSandboxValidation", "backend/ProductionSafetyValidatorTest.java", "test"));
    snapshot.edges.push(edge("zz-consumer", "config", "seo", "calls"), edge("seo-case-association", "seo-case", "seo", "test-exercises"));
    for (let i = 0; i < 80; i++) {
      snapshot.nodes.push(node(`lexical${i}`, `seoEnvironmentLocal${i}`, file, "symbol", { symbolKind: "VariableDeclaration" }));
      const relation = edge(`aaa-local${i}`, "seo", `lexical${i}`, "references"); relation.metadata.binding = "lexical";
      snapshot.edges.push(relation);
    }
    const packet = selectRepositoryContext(snapshot, "Corrigir validação de SEO em homologação", { writeScope: [file], maxChars: 6000 });
    expect(packet.nodes.some(node => node.id === "config")).toBe(true);
    expect(packet.nodes.some(node => node.id === "seo-case")).toBe(true);
    expect(packet.nodes.some(node => node.id === "backend-noise")).toBe(false);
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(6000);
  });
  test("dense HTTP consumers cannot exhaust the budget before the request/endpoint capsule", () => {
    const snapshot = fixture();
    const file = "web/rooms.ts";
    snapshot.nodes.push(node("rooms", "getRooms", file, "symbol", { exported: true, symbolKind: "FunctionDeclaration" }),
      node("rooms-request", "GET /rooms", file, "http-call"), node("rooms-api", "GET /rooms", "backend/RoomApi.java", "endpoint"));
    snapshot.edges.push(edge("zz-request", "rooms", "rooms-request", "calls"), edge("zz-endpoint", "rooms-request", "rooms-api", "calls"));
    for (let i = 0; i < 80; i++) {
      snapshot.nodes.push(node(`consumer${i}`, `roomsConsumer${i}`, `web/pages/${i}.vue`));
      snapshot.edges.push(edge(`aaa-consumer${i}`, `consumer${i}`, "rooms", "calls"));
    }
    const packet = selectRepositoryContext(snapshot, "getRooms", { writeScope: [file], maxChars: 4096 });
    expect(packet.nodes.some(node => node.id === "rooms-api" && node.access === "read-only")).toBe(true);
    expect(packet.edges.some(edge => edge.id === "zz-request")).toBe(true);
    expect(packet.edges.some(edge => edge.id === "zz-endpoint")).toBe(true);
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(4096);
  });
  test("each file in a multi-file scope retains its own associated case", () => {
    const snapshot = fixture();
    snapshot.nodes = [node("foo", "foo", "src/foo.ts"), node("bar", "bar", "src/bar.ts"),
      node("foo-case", "foo case", "tests/foo.test.ts", "test"), node("bar-case", "bar case", "tests/bar.test.ts", "test")];
    snapshot.edges = [edge("foo-test", "foo-case", "foo", "test-exercises"), edge("bar-test", "bar-case", "bar", "test-exercises")];
    const scope = ["src/foo.ts", "src/bar.ts"];
    const packet = selectRepositoryContext(snapshot, "fix foo and bar", { writeScope: scope, maxChars: 10000 });
    expect(packet.writeScope).toEqual(scope);
    expect(packet.nodes.map(node => node.id).sort()).toEqual(["bar", "bar-case", "foo", "foo-case"]);
    expect(packet.groups.find(group => group.subject === "foo")?.tests).toEqual(["foo-case"]);
    expect(packet.groups.find(group => group.subject === "bar")?.tests).toEqual(["bar-case"]);
    expect(packet.truncated).toBe(false);
  });
  test("selection is repeatable and every relation/group retains its node endpoints under small budgets", () => {
    const snapshot = fixture();
    for (let i = 0; i < 100; i++) {
      snapshot.nodes.push(node(`extra${i}`, `customerConsumer${i}`, `long/directory/${i}/customer.ts`));
      snapshot.edges.push(edge(`relation${i}`, `extra${i}`, "service", "references"));
    }
    const options = { writeScope: ["api/customers.ts"], maxChars: 2048, maxNodes: 5, maxEdges: 5 };
    const packet = selectRepositoryContext(snapshot, "Fix customer deletion", options);
    expect(selectRepositoryContext(snapshot, "Fix customer deletion", options)).toEqual(packet);
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(2048);
    expect(packet.truncated).toBe(true);
    const ids = new Set(packet.nodes.map(node => node.id));
    expect(packet.edges.every(edge => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(packet.groups.every(group => ids.has(group.subject) && [...group.consumers, ...group.tests, ...group.related].every(id => ids.has(id)))).toBe(true);
    expect(packet.metrics.omittedRelations).toBeGreaterThan(0);
  });
  test("Java call site noise is grouped until a snapshot-bound explicit expansion", () => {
    const snapshot = fixture();
    for (let i = 0; i < 300; i++) snapshot.nodes.push({ ...node(`call${i}`, "auditCustomer", "src/CustomerService.java", "java-call", { owner: "service", qualifier: "audit" }),
      evidence: { ...evidence, assurance: "syntactic", resolution: "unresolved", adapter: "java" } });
    const groups = groupRepositoryJavaCalls(snapshot.nodes);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.metadata.callSiteCount).toBe(300);
    const broad = queryRepository(snapshot, "locate auditCustomer");
    expect(broad.items.filter(item => item.kind === "java-call")).toHaveLength(0);
    expect(broad.items.some(item => item.kind === "java-call-group")).toBe(true);
    expect(queryRepository(snapshot, `calls ${groups[0]!.id}`).ok).toBe(false);
    const expanded = queryRepository(snapshot, `calls ${groups[0]!.id}`, { snapshotId: snapshot.snapshotId, limit: 3 });
    expect(expanded.total).toBe(300);
    expect(expanded.items).toHaveLength(3);
    expect(expanded.summary.callSites).toContain("syntactic");
    expect(expanded.nextCursor).toBeTruthy();
    expect(selectRepositoryContext(snapshot, "Fix customer service", { maxChars: 4096 }).metrics.javaCallSitesOmitted).toBe(300);
  });
  test("tests queries exclude unrelated siblings despite sharing a test source file", () => {
    const snapshot = fixture();
    expect(queryRepository(snapshot, "tests service").items.map(item => item.id)).toEqual(["test"]);
    snapshot.nodes.push(node("suite", "CustomerService tests", "tests/customer.test.ts", "test", { suite: true }));
    snapshot.edges.push(edge("suite-edge", "suite", "service", "test-references"));
    expect(queryRepository(snapshot, "tests service").items.map(item => item.id)).toEqual(["test"]);
    expect(selectRepositoryContext(snapshot, "Fix CustomerService").nodes.some(node => node.id === "suite")).toBe(false);
  });
});
