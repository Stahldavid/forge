package dev.forgeos.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ForgeHttpHandler implements HttpHandler {
  private final ForgeRegistry registry;

  public ForgeHttpHandler(ForgeRegistry registry) {
    this.registry = registry;
  }

  public static HttpServer listen(ForgeRegistry registry, String host, int port) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
    ForgeHttpHandler handler = new ForgeHttpHandler(registry);
    server.createContext("/", handler);
    server.start();
    return server;
  }

  @Override
  public void handle(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath();
    try {
      if (registry.healthPath().equals(path)) {
        writeJson(exchange, 200, Map.of("ok", true, "service", registry.serviceName()));
        return;
      }
      if ("/manifest".equals(path)) {
        String baseUrl = queryParams(exchange.getRequestURI()).getOrDefault("baseUrl", registry.baseUrl());
        writeJson(exchange, 200, registry.manifest(baseUrl));
        return;
      }
      if (path.startsWith("/commands/")) {
        handleRuntime(exchange, EntryKind.COMMAND, path.substring("/commands/".length()));
        return;
      }
      if (path.startsWith("/queries/")) {
        handleRuntime(exchange, EntryKind.QUERY, path.substring("/queries/".length()));
        return;
      }
      writeError(exchange, 404, traceIdFrom(exchange, null), "FORGE_JAVA_ROUTE_NOT_FOUND", "route not found");
    } catch (Exception error) {
      writeError(exchange, 500, traceIdFrom(exchange, null), "FORGE_JAVA_HANDLER_FAILED", error.getMessage());
    }
  }

  private void handleRuntime(HttpExchange exchange, EntryKind kind, String rawName) throws IOException {
    String name = decode(rawName);
    if (!"POST".equals(exchange.getRequestMethod()) && !"GET".equals(exchange.getRequestMethod())) {
      writeError(exchange, 405, traceIdFrom(exchange, null), "FORGE_JAVA_METHOD_NOT_ALLOWED", "external entry only accepts GET or POST");
      return;
    }

    ForgeRegistry.RegisteredEntry registered = registry.lookup(kind, name);
    if (registered == null) {
      writeError(exchange, 404, traceIdFrom(exchange, null), "FORGE_JAVA_ENTRY_NOT_FOUND", "external entry not found");
      return;
    }

    RequestEnvelope envelope;
    try {
      envelope = readEnvelope(exchange);
    } catch (Exception error) {
      writeError(exchange, 400, traceIdFrom(exchange, null), "FORGE_JAVA_BAD_REQUEST", error.getMessage());
      return;
    }

    String traceId = traceIdFrom(exchange, envelope);
    ForgeCall forge = envelope.forge() == null
        ? new ForgeCall(registry.serviceName(), name, kind.value(), traceId)
        : envelope.forge().withDefaults(registry.serviceName(), name, kind.value(), traceId);
    Auth auth = envelope.auth() == null || envelope.auth().kind() == null
        ? authFromHeaders(exchange.getRequestHeaders())
        : envelope.auth();

    ForgeContext context = new ForgeContext(auth, forge, exchange.getRequestHeaders());
    try {
      Object result = registered.handler().handle(context, envelope.args());
      writeJson(exchange, 200, ResponseEnvelope.ok(result, forge.traceId()));
    } catch (Exception error) {
      writeError(exchange, 500, forge.traceId(), "FORGE_JAVA_HANDLER_FAILED", error.getMessage());
    }
  }

  private RequestEnvelope readEnvelope(HttpExchange exchange) throws IOException {
    if ("GET".equals(exchange.getRequestMethod())) {
      String args = queryParams(exchange.getRequestURI()).getOrDefault("args", "{}");
      JsonNode argsNode = Json.MAPPER.readTree(args);
      return new RequestEnvelope(argsNode, null, null);
    }

    try (InputStream body = exchange.getRequestBody()) {
      byte[] bytes = body.readAllBytes();
      if (bytes.length == 0) {
        return new RequestEnvelope(Json.MAPPER.createObjectNode(), null, null);
      }
      RequestEnvelope envelope = Json.MAPPER.readValue(bytes, RequestEnvelope.class);
      JsonNode args = envelope.args() == null ? Json.MAPPER.createObjectNode() : envelope.args();
      return new RequestEnvelope(args, envelope.auth(), envelope.forge());
    }
  }

  private static Auth authFromHeaders(Headers headers) {
    String kind = firstHeader(headers, "x-forge-auth-kind");
    if (kind == null || kind.isBlank()) {
      kind = "anonymous";
    }
    return new Auth(
        kind,
        firstHeader(headers, "x-forge-user-id"),
        firstHeader(headers, "x-forge-tenant-id"),
        firstHeader(headers, "x-forge-role"),
        null,
        null,
        null,
        null,
        null
    );
  }

  private static String traceIdFrom(HttpExchange exchange, RequestEnvelope envelope) {
    if (envelope != null && envelope.forge() != null && envelope.forge().traceId() != null) {
      return envelope.forge().traceId();
    }
    return firstHeader(exchange.getRequestHeaders(), "x-forge-trace-id");
  }

  private static String firstHeader(Headers headers, String name) {
    List<String> values = headers.get(name);
    if (values == null || values.isEmpty()) {
      values = headers.get(name.toLowerCase());
    }
    return values == null || values.isEmpty() ? null : values.get(0);
  }

  private static Map<String, String> queryParams(URI uri) {
    Map<String, String> params = new HashMap<>();
    String query = uri.getRawQuery();
    if (query == null || query.isBlank()) {
      return params;
    }
    for (String part : query.split("&")) {
      String[] pieces = part.split("=", 2);
      params.put(decode(pieces[0]), pieces.length > 1 ? decode(pieces[1]) : "");
    }
    return params;
  }

  private static String decode(String value) {
    return URLDecoder.decode(value, StandardCharsets.UTF_8);
  }

  private static void writeError(HttpExchange exchange, int status, String traceId, String code, String message) throws IOException {
    writeJson(exchange, status, ResponseEnvelope.error(code, message, traceId));
  }

  private static void writeJson(HttpExchange exchange, int status, Object body) throws IOException {
    byte[] bytes = Json.MAPPER.writeValueAsBytes(body);
    exchange.getResponseHeaders().set("content-type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream response = exchange.getResponseBody()) {
      response.write(bytes);
    }
  }
}
