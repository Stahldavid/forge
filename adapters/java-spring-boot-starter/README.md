# Forge Java Spring Boot Starter

`adapters/java-spring-boot-starter` is the first Spring integration layer for
Forge external runtimes. It discovers a bean annotated with
`@ForgeExternalService`, registers methods annotated with `@ForgeCommand` and
`@ForgeQuery`, and exposes a `ForgeRegistry` bean.

```java
@Service
@ForgeExternalService(name = "billing", baseUrl = "http://127.0.0.1:8080")
public class BillingService {
  @ForgeCommand(
      name = "createInvoice",
      policy = "billing.manage",
      tenantScoped = true,
      needsApproval = true,
      effects = {"invoice.created"})
  public Invoice createInvoice(ForgeContext context, CreateInvoiceInput input) {
    return new Invoice("inv_java_1", input.title(), context.auth().tenantId());
  }

  @ForgeQuery(name = "listInvoices", policy = "billing.manage", tenantScoped = true)
  public List<Invoice> listInvoices(ForgeContext context) {
    return List.of(new Invoice("inv_java_1", "Spring invoice", context.auth().tenantId()));
  }
}
```

The starter intentionally keeps HTTP endpoint wiring thin in this first version.
Applications can inject the generated `ForgeRegistry` and serve it with the core
adapter, or add their own Spring MVC bridge. Full MVC/Actuator auto-endpoints
are a follow-up layer.
