# Forge Java Adapter

`adapters/java` is the minimal Java SDK for external Forge runtimes. It mirrors
the Go adapter: register commands and queries, emit a `forge.manifest.json`, and
serve Forge-compatible HTTP envelopes.

```java
ForgeRegistry app = Forge.service("billing",
    Forge.framework("java/jdk-http"),
    Forge.baseUrl("http://127.0.0.1:8788"));

app.command("createInvoice",
    Forge.handle(CreateInvoiceInput.class, Billing::createInvoice),
    Forge.policy("billing.manage"),
    Forge.tenantScoped(true),
    Forge.needsApproval(true),
    Forge.inputSchema(Schemas.object(Map.of("title", Schemas.string()), "title")));

app.query("listInvoices",
    Forge.handle(EmptyInput.class, Billing::listInvoices),
    Forge.policy("billing.manage"),
    Forge.tenantScoped(true),
    Forge.readOnly());

ForgeHttpHandler.listen(app, "127.0.0.1", 8788);
```

The HTTP handler exposes:

```text
GET  /health
GET  /manifest?baseUrl=http://127.0.0.1:8788
POST /commands/:name
POST /queries/:name
```

The handler accepts Forge runtime envelopes and returns Forge response
envelopes:

```json
{
  "args": { "title": "Invoice" },
  "auth": { "kind": "user", "userId": "u1", "tenantId": "t1", "role": "admin" },
  "forge": { "service": "billing", "entry": "createInvoice", "kind": "command", "traceId": "trace_..." }
}
```

Build locally:

```bash
mvn -f adapters/java/pom.xml install
mvn -f examples/java-billing/pom.xml package
```

Emit and import a manifest:

```bash
java -jar examples/java-billing/target/java-billing-0.1.0-alpha.11-all.jar --manifest --base-url http://127.0.0.1:8788 > java-billing.manifest.json
forge manifest import java-billing.manifest.json --json
forge generate
```

Invoke through Forge:

```bash
forge run billing.createInvoice --args '{"title":"Invoice"}' --role admin --tenant-id tenant-a
forge query billing.listInvoices --args '{}' --role admin --tenant-id tenant-a
```
