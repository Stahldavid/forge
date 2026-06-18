package dev.forgeos.adapter;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Arrays;
import java.util.List;

public final class Forge {
  private Forge() {
  }

  public static ForgeRegistry service(String serviceName, ForgeRegistry.RegistryOption... options) {
    return new ForgeRegistry(serviceName, options);
  }

  public static ForgeRegistry.RegistryOption framework(String value) {
    return registry -> registry.setFramework(value);
  }

  public static ForgeRegistry.RegistryOption baseUrl(String value) {
    return registry -> registry.setBaseUrl(value);
  }

  public static ForgeRegistry.RegistryOption health(String path) {
    return registry -> registry.setHealth(path);
  }

  public static ForgeRegistry.RegistryOption schemaRef(String name, Object schema) {
    return registry -> registry.addSchema(name, schema);
  }

  public static ForgeRegistry.EntryOption description(String value) {
    return entry -> entry.description = value;
  }

  public static ForgeRegistry.EntryOption path(String value) {
    return entry -> entry.path = value;
  }

  public static ForgeRegistry.EntryOption method(String value) {
    return entry -> entry.method = value;
  }

  public static ForgeRegistry.EntryOption inputSchema(Object schema) {
    return entry -> entry.inputSchema = schema;
  }

  public static ForgeRegistry.EntryOption outputSchema(Object schema) {
    return entry -> entry.outputSchema = schema;
  }

  public static ForgeRegistry.EntryOption policy(String value) {
    return entry -> entry.policy = value;
  }

  public static ForgeRegistry.EntryOption tenantScoped(boolean value) {
    return entry -> entry.tenantScoped = value;
  }

  public static ForgeRegistry.EntryOption transaction(TransactionMode value) {
    return entry -> entry.transaction = value.value();
  }

  public static ForgeRegistry.EntryOption risk(Risk value) {
    return entry -> entry.risk = value.value();
  }

  public static ForgeRegistry.EntryOption needsApproval(boolean value) {
    return entry -> entry.needsApproval = value;
  }

  public static ForgeRegistry.EntryOption effects(String... values) {
    return entry -> entry.effects = List.copyOf(Arrays.asList(values));
  }

  public static ForgeRegistry.EntryOption readOnly() {
    return entry -> {
      entry.transaction = TransactionMode.READ_ONLY.value();
      entry.risk = Risk.READ.value();
    };
  }

  public static <In, Out> ForgeHandler handle(
      Class<In> inputClass,
      TypedForgeHandler<In, Out> handler
  ) {
    return (context, rawArgs) -> {
      JsonNode args = rawArgs == null || rawArgs.isNull()
          ? Json.MAPPER.createObjectNode()
          : rawArgs;
      In input = Json.MAPPER.treeToValue(args, inputClass);
      return handler.handle(context, input);
    };
  }
}
