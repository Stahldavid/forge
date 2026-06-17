package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"

	forge "github.com/Stahldavid/forge/adapters/go"
)

type CreateInvoiceInput struct {
	Title string `json:"title"`
}

type Invoice struct {
	ID       string `json:"id"`
	Title    string `json:"title,omitempty"`
	Tenant   string `json:"tenant"`
	TraceID  string `json:"traceId,omitempty"`
	AuthKind string `json:"authKind,omitempty"`
	UserID   string `json:"userId,omitempty"`
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "address for the external billing service")
	baseURL := flag.String("base-url", "", "base URL written into the Forge manifest")
	manifest := flag.Bool("manifest", false, "write forge.manifest.json to stdout and exit")
	flag.Parse()

	if *baseURL == "" {
		*baseURL = "http://" + *addr
	}

	app := newBillingApp(*baseURL)
	if *manifest {
		if err := app.WriteManifest(os.Stdout, *baseURL); err != nil {
			log.Fatal(err)
		}
		return
	}

	log.Printf("go billing external service listening on http://%s", *addr)
	if err := http.ListenAndServe(*addr, app.HTTPHandler()); err != nil {
		log.Fatal(err)
	}
}

func newBillingApp(baseURL string) *forge.Registry {
	app := forge.New("billing",
		forge.Framework("go/net-http"),
		forge.BaseURL(baseURL),
		forge.Health("/health"),
	)

	app.Command("createInvoice", forge.Handle(createInvoice),
		forge.Description("Create an invoice in the external Go billing service."),
		forge.Policy("billing.manage"),
		forge.TenantScoped(true),
		forge.TransactionMode(forge.TransactionExternalManaged),
		forge.EntryRisk(forge.RiskWrite),
		forge.NeedsApproval(true),
		forge.Effects("invoice.created"),
		forge.InputSchema(forge.Object(map[string]any{
			"title": forge.String(),
		}, "title")),
		forge.OutputSchema(invoiceSchema()),
	)

	app.Query("listInvoices", forge.Handle(listInvoices),
		forge.Description("List invoices visible to the current tenant."),
		forge.Policy("billing.manage"),
		forge.TenantScoped(true),
		forge.ReadOnly(),
		forge.OutputSchema(forge.Array(invoiceSchema())),
	)

	return app
}

func createInvoice(ctx context.Context, call *forge.Context, input CreateInvoiceInput) (Invoice, error) {
	if input.Title == "" {
		return Invoice{}, errors.New("title is required")
	}
	if call.Auth.TenantID == "" {
		return Invoice{}, errors.New("tenant id is required")
	}
	return Invoice{
		ID:       "inv_go_1",
		Title:    input.Title,
		Tenant:   call.Auth.TenantID,
		TraceID:  call.Forge.TraceID,
		AuthKind: call.Auth.Kind,
		UserID:   call.Auth.UserID,
	}, nil
}

func listInvoices(ctx context.Context, call *forge.Context, input struct{}) ([]Invoice, error) {
	if call.Auth.TenantID == "" {
		return nil, errors.New("tenant id is required")
	}
	return []Invoice{{
		ID:     "inv_go_1",
		Title:  "Go adapter invoice",
		Tenant: call.Auth.TenantID,
	}}, nil
}

func invoiceSchema() forge.Schema {
	return forge.Object(map[string]any{
		"id":       forge.String(),
		"title":    forge.String(),
		"tenant":   forge.String(),
		"traceId":  forge.String(),
		"authKind": forge.String(),
		"userId":   forge.String(),
	}, "id", "tenant")
}
