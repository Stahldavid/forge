package forge

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

func (registry *Registry) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(registry.service.Health, registry.handleHealth)
	mux.HandleFunc("/manifest", registry.handleManifest)
	mux.HandleFunc("/commands/", registry.handleRuntime(KindCommand, "/commands/"))
	mux.HandleFunc("/queries/", registry.handleRuntime(KindQuery, "/queries/"))
	return mux
}

func (registry *Registry) handleHealth(response http.ResponseWriter, request *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"ok":      true,
		"service": registry.service.Name,
	})
}

func (registry *Registry) handleManifest(response http.ResponseWriter, request *http.Request) {
	baseURL := request.URL.Query().Get("baseUrl")
	if baseURL == "" {
		baseURL = registry.service.BaseURL
	}
	writeJSON(response, http.StatusOK, registry.Manifest(baseURL))
}

func (registry *Registry) handleRuntime(kind EntryKind, prefix string) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		name := strings.TrimPrefix(request.URL.Path, prefix)
		registered, ok := registry.lookup[lookupKey(kind, name)]
		if !ok {
			writeError(response, http.StatusNotFound, "", "FORGE_GO_ENTRY_NOT_FOUND", "external entry not found")
			return
		}
		if request.Method != http.MethodPost && request.Method != http.MethodGet {
			writeError(response, http.StatusMethodNotAllowed, "", "FORGE_GO_METHOD_NOT_ALLOWED", "external entry only accepts GET or POST")
			return
		}

		envelope, err := readRequestEnvelope(request)
		traceID := traceIDFrom(request, envelope)
		if err != nil {
			writeError(response, http.StatusBadRequest, traceID, "FORGE_GO_BAD_REQUEST", err.Error())
			return
		}
		if envelope.Forge.Service == "" {
			envelope.Forge.Service = registry.service.Name
		}
		if envelope.Forge.Entry == "" {
			envelope.Forge.Entry = name
		}
		if envelope.Forge.Kind == "" {
			envelope.Forge.Kind = string(kind)
		}
		if envelope.Forge.TraceID == "" {
			envelope.Forge.TraceID = traceID
		}
		if envelope.Auth.Kind == "" {
			envelope.Auth = authFromHeaders(request.Header)
		}

		call := &Context{
			Auth:    envelope.Auth,
			Forge:   envelope.Forge,
			Headers: request.Header,
		}
		result, err := registered.handler(request.Context(), call, envelope.Args)
		if err != nil {
			writeError(response, http.StatusInternalServerError, envelope.Forge.TraceID, "FORGE_GO_HANDLER_FAILED", err.Error())
			return
		}
		writeJSON(response, http.StatusOK, ResponseEnvelope{
			OK:      true,
			Result:  result,
			TraceID: envelope.Forge.TraceID,
		})
	}
}

func readRequestEnvelope(request *http.Request) (RequestEnvelope, error) {
	if request.Method == http.MethodGet {
		args := request.URL.Query().Get("args")
		if args == "" {
			args = "{}"
		}
		return RequestEnvelope{Args: json.RawMessage(args)}, nil
	}
	defer request.Body.Close()
	var envelope RequestEnvelope
	decoder := json.NewDecoder(request.Body)
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, err
	}
	if len(envelope.Args) == 0 {
		envelope.Args = json.RawMessage("{}")
	}
	if !json.Valid(envelope.Args) {
		return envelope, errors.New("request args must be valid JSON")
	}
	return envelope, nil
}

func authFromHeaders(headers http.Header) Auth {
	auth := Auth{Kind: headers.Get("x-forge-auth-kind")}
	if auth.Kind == "" {
		auth.Kind = "anonymous"
	}
	auth.UserID = headers.Get("x-forge-user-id")
	auth.TenantID = headers.Get("x-forge-tenant-id")
	auth.Role = headers.Get("x-forge-role")
	return auth
}

func traceIDFrom(request *http.Request, envelope RequestEnvelope) string {
	if envelope.Forge.TraceID != "" {
		return envelope.Forge.TraceID
	}
	return request.Header.Get("x-forge-trace-id")
}

func writeError(response http.ResponseWriter, status int, traceID string, code string, message string) {
	writeJSON(response, status, ResponseEnvelope{
		OK: false,
		Diagnostics: []Diagnostic{{
			Severity: "error",
			Code:     code,
			Message:  message,
			Docs:     []string{"docs/forge-protocol.md"},
		}},
		Error: &ErrorInfo{
			Code:    code,
			Message: message,
		},
		TraceID: traceID,
	})
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}
