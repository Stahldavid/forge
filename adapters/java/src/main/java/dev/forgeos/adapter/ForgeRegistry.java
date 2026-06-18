package dev.forgeos.adapter;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ForgeRegistry {
  private final Service service;
  private final Map<String, Object> schemas = new LinkedHashMap<>();
  private final List<RegisteredEntry> entries = new ArrayList<>();
  private final Map<String, RegisteredEntry> lookup = new LinkedHashMap<>();
  private String framework = "java/jdk-http";

  public ForgeRegistry(String serviceName, RegistryOption... options) {
    this.service = new Service(serviceName, "http", null, null, "/health");
    for (RegistryOption option : options) {
      option.apply(this);
    }
  }

  public String serviceName() {
    return service.name();
  }

  public String baseUrl() {
    return service.baseUrl();
  }

  public String healthPath() {
    return service.health() == null ? "/health" : service.health();
  }

  public void command(String name, ForgeHandler handler, EntryOption... options) {
    Entry entry = new Entry();
    entry.name = name;
    entry.kind = EntryKind.COMMAND.value();
    entry.path = "/commands/" + name;
    entry.method = "POST";
    entry.transaction = TransactionMode.EXTERNAL_MANAGED.value();
    entry.risk = Risk.WRITE.value();
    add(entry, handler, options);
  }

  public void query(String name, ForgeHandler handler, EntryOption... options) {
    Entry entry = new Entry();
    entry.name = name;
    entry.kind = EntryKind.QUERY.value();
    entry.path = "/queries/" + name;
    entry.method = "POST";
    entry.transaction = TransactionMode.READ_ONLY.value();
    entry.risk = Risk.READ.value();
    add(entry, handler, options);
  }

  public Manifest manifest(String baseUrl) {
    Service manifestService = service;
    if (baseUrl != null && !baseUrl.isBlank()) {
      manifestService = new Service(service.name(), service.transport(), baseUrl, service.command(), service.health());
    }
    List<Entry> manifestEntries = entries.stream().map(registered -> registered.entry().copy()).toList();
    return new Manifest("1.0", "java", framework, manifestService, manifestEntries, schemas.isEmpty() ? null : schemas);
  }

  public byte[] marshalManifest(String baseUrl) throws IOException {
    return Json.MAPPER.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest(baseUrl));
  }

  public void writeManifest(OutputStream output, String baseUrl) throws IOException {
    output.write(marshalManifest(baseUrl));
    output.write('\n');
  }

  RegisteredEntry lookup(EntryKind kind, String name) {
    return lookup.get(key(kind, name));
  }

  void setFramework(String framework) {
    this.framework = framework;
  }

  void setBaseUrl(String baseUrl) {
    this.service.setBaseUrl(baseUrl);
  }

  void setHealth(String health) {
    this.service.setHealth(health);
  }

  void addSchema(String name, Object schema) {
    this.schemas.put(name, schema);
  }

  private void add(Entry entry, ForgeHandler handler, EntryOption... options) {
    for (EntryOption option : options) {
      option.apply(entry);
    }
    RegisteredEntry registered = new RegisteredEntry(entry, handler);
    entries.add(registered);
    lookup.put(key(EntryKind.valueOf(entry.kind.toUpperCase()), entry.name), registered);
  }

  private static String key(EntryKind kind, String name) {
    return kind.value() + ":" + name;
  }

  @FunctionalInterface
  public interface RegistryOption {
    void apply(ForgeRegistry registry);
  }

  @FunctionalInterface
  public interface EntryOption {
    void apply(Entry entry);
  }

  record RegisteredEntry(Entry entry, ForgeHandler handler) {
  }
}
