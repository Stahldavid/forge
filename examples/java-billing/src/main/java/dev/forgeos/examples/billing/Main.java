package dev.forgeos.examples.billing;

import com.sun.net.httpserver.HttpServer;
import dev.forgeos.adapter.Forge;
import dev.forgeos.adapter.ForgeContext;
import dev.forgeos.adapter.ForgeHttpHandler;
import dev.forgeos.adapter.ForgeRegistry;
import dev.forgeos.adapter.Risk;
import dev.forgeos.adapter.Schemas;
import dev.forgeos.adapter.TransactionMode;
import java.util.Map;

public final class Main {
  private Main() {
  }

  public static void main(String[] args) throws Exception {
    Options options = Options.parse(args);
    ForgeRegistry app = newBillingApp(options.baseUrl());

    if (options.manifest()) {
      app.writeManifest(System.out, options.baseUrl());
      return;
    }

    String[] addressParts = options.addr().split(":", 2);
    String host = addressParts[0];
    int port = Integer.parseInt(addressParts.length > 1 ? addressParts[1] : "8788");
    HttpServer server = ForgeHttpHandler.listen(app, host, port);
    System.err.printf("java billing external service listening on http://%s%n", options.addr());
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(0)));
  }

  static ForgeRegistry newBillingApp(String baseUrl) {
    ForgeRegistry app = Forge.service("billing",
        Forge.framework("java/jdk-http"),
        Forge.baseUrl(baseUrl),
        Forge.health("/health")
    );

    app.command("createInvoice", Forge.handle(CreateInvoiceInput.class, Main::createInvoice),
        Forge.description("Create an invoice in the external Java billing service."),
        Forge.policy("billing.manage"),
        Forge.tenantScoped(true),
        Forge.transaction(TransactionMode.EXTERNAL_MANAGED),
        Forge.risk(Risk.WRITE),
        Forge.needsApproval(true),
        Forge.effects("invoice.created"),
        Forge.inputSchema(Schemas.object(Map.of("title", Schemas.string()), "title")),
        Forge.outputSchema(invoiceSchema())
    );

    app.query("listInvoices", Forge.handle(EmptyInput.class, Main::listInvoices),
        Forge.description("List invoices visible to the current tenant."),
        Forge.policy("billing.manage"),
        Forge.tenantScoped(true),
        Forge.readOnly(),
        Forge.outputSchema(Schemas.array(invoiceSchema()))
    );

    return app;
  }

  static Invoice createInvoice(ForgeContext context, CreateInvoiceInput input) {
    if (input.title() == null || input.title().isBlank()) {
      throw new IllegalArgumentException("title is required");
    }
    if (context.auth().tenantId() == null || context.auth().tenantId().isBlank()) {
      throw new IllegalArgumentException("tenant id is required");
    }
    return new Invoice(
        "inv_java_1",
        input.title(),
        context.auth().tenantId(),
        context.forge().traceId(),
        context.auth().kind(),
        context.auth().userId()
    );
  }

  static Invoice[] listInvoices(ForgeContext context, EmptyInput input) {
    if (context.auth().tenantId() == null || context.auth().tenantId().isBlank()) {
      throw new IllegalArgumentException("tenant id is required");
    }
    return new Invoice[] {
        new Invoice("inv_java_1", "Java adapter invoice", context.auth().tenantId(), null, null, null)
    };
  }

  static Map<String, Object> invoiceSchema() {
    return Schemas.object(Map.of(
        "id", Schemas.string(),
        "title", Schemas.string(),
        "tenant", Schemas.string(),
        "traceId", Schemas.string(),
        "authKind", Schemas.string(),
        "userId", Schemas.string()
    ), "id", "tenant");
  }

  record EmptyInput() {
  }

  record Options(String addr, String baseUrl, boolean manifest) {
    static Options parse(String[] args) {
      String addr = "127.0.0.1:8788";
      String baseUrl = null;
      boolean manifest = false;

      for (int index = 0; index < args.length; index += 1) {
        String arg = args[index];
        if ("--manifest".equals(arg)) {
          manifest = true;
        } else if ("--addr".equals(arg) && index + 1 < args.length) {
          addr = args[++index];
        } else if ("--base-url".equals(arg) && index + 1 < args.length) {
          baseUrl = args[++index];
        }
      }

      if (baseUrl == null || baseUrl.isBlank()) {
        baseUrl = "http://" + addr;
      }
      return new Options(addr, baseUrl, manifest);
    }
  }
}
