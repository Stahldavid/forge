package forge

import (
	"context"
	"encoding/json"
	"net/http"
)

const ProtocolVersion = "1.0"

type EntryKind string
type Risk string
type Transaction string

const (
	KindCommand EntryKind = "command"
	KindQuery   EntryKind = "query"

	RiskRead        Risk = "read"
	RiskWrite       Risk = "write"
	RiskDestructive Risk = "destructive"
	RiskExternal    Risk = "external"

	TransactionReadOnly        Transaction = "read-only"
	TransactionExternalManaged Transaction = "external-managed"
	TransactionForgeManaged    Transaction = "forge-managed"
	TransactionSaga            Transaction = "saga"
)

type Schema map[string]any

type Manifest struct {
	ForgeProtocol string         `json:"forgeProtocol"`
	Language      string         `json:"language"`
	Framework     string         `json:"framework,omitempty"`
	Service       Service        `json:"service"`
	Entries       []Entry        `json:"entries"`
	Schemas       map[string]any `json:"schemas,omitempty"`
}

type Service struct {
	Name      string `json:"name"`
	Transport string `json:"transport"`
	BaseURL   string `json:"baseUrl,omitempty"`
	Command   string `json:"command,omitempty"`
	Health    string `json:"health,omitempty"`
}

type Entry struct {
	Name          string      `json:"name"`
	Kind          EntryKind   `json:"kind"`
	Description   string      `json:"description,omitempty"`
	Path          string      `json:"path,omitempty"`
	Method        string      `json:"method,omitempty"`
	InputSchema   any         `json:"inputSchema,omitempty"`
	OutputSchema  any         `json:"outputSchema,omitempty"`
	Policy        string      `json:"policy,omitempty"`
	TenantScoped  bool        `json:"tenantScoped,omitempty"`
	Transaction   Transaction `json:"transaction,omitempty"`
	Risk          Risk        `json:"risk,omitempty"`
	NeedsApproval *bool       `json:"needsApproval,omitempty"`
	Effects       []string    `json:"effects,omitempty"`
}

type Auth struct {
	Kind        string         `json:"kind"`
	UserID      string         `json:"userId,omitempty"`
	TenantID    string         `json:"tenantId,omitempty"`
	Role        string         `json:"role,omitempty"`
	Roles       []string       `json:"roles,omitempty"`
	Permissions []string       `json:"permissions,omitempty"`
	Email       string         `json:"email,omitempty"`
	Name        string         `json:"name,omitempty"`
	Claims      map[string]any `json:"claims,omitempty"`
}

type ForgeCall struct {
	Service string `json:"service"`
	Entry   string `json:"entry"`
	Kind    string `json:"kind"`
	TraceID string `json:"traceId"`
}

type Context struct {
	Auth    Auth
	Forge   ForgeCall
	Headers http.Header
}

type HandlerFunc func(context.Context, *Context, json.RawMessage) (any, error)

type RequestEnvelope struct {
	Args  json.RawMessage `json:"args"`
	Auth  Auth            `json:"auth"`
	Forge ForgeCall       `json:"forge"`
}

type ResponseEnvelope struct {
	OK          bool         `json:"ok"`
	Result      any          `json:"result,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics,omitempty"`
	Error       *ErrorInfo   `json:"error,omitempty"`
	TraceID     string       `json:"traceId,omitempty"`
}

type Diagnostic struct {
	Severity string   `json:"severity"`
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	File     string   `json:"file,omitempty"`
	FixHint  string   `json:"fixHint,omitempty"`
	Docs     []string `json:"docs,omitempty"`
}

type ErrorInfo struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func Decode(raw json.RawMessage, target any) error {
	if len(raw) == 0 || string(raw) == "null" {
		raw = json.RawMessage("{}")
	}
	return json.Unmarshal(raw, target)
}

func Handle[In any, Out any](handler func(context.Context, *Context, In) (Out, error)) HandlerFunc {
	return func(ctx context.Context, call *Context, raw json.RawMessage) (any, error) {
		var input In
		if err := Decode(raw, &input); err != nil {
			var zero Out
			return zero, err
		}
		return handler(ctx, call, input)
	}
}
