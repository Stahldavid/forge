# Forge Go Adapter

`adapters/go` is the minimal Go SDK for external Forge runtimes. It registers
commands and queries, emits `forge.manifest.json`, and exposes a Forge-compatible
HTTP handler.

```go
app := forge.New("billing", forge.BaseURL("http://127.0.0.1:8787"))

app.Command("createInvoice", forge.Handle(createInvoice),
    forge.Policy("billing.manage"),
    forge.TenantScoped(true),
    forge.NeedsApproval(true),
)

app.Query("listInvoices", forge.Handle(listInvoices),
    forge.Policy("billing.manage"),
    forge.TenantScoped(true),
)
```

The HTTP handler accepts Forge runtime envelopes on `/commands/:name` and
`/queries/:name`, then returns `{ "ok": true, "result": ... }` envelopes.
