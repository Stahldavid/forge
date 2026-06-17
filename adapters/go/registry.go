package forge

import (
	"encoding/json"
	"io"
)

type Registry struct {
	service   Service
	framework string
	schemas   map[string]any
	entries   []registeredEntry
	lookup    map[string]registeredEntry
}

type registeredEntry struct {
	entry   Entry
	handler HandlerFunc
}

type RegistryOption func(*Registry)
type EntryOption func(*Entry)

func New(serviceName string, options ...RegistryOption) *Registry {
	registry := &Registry{
		service: Service{
			Name:      serviceName,
			Transport: "http",
			Health:    "/health",
		},
		framework: "net/http",
		schemas:   map[string]any{},
		lookup:    map[string]registeredEntry{},
	}
	for _, option := range options {
		option(registry)
	}
	return registry
}

func Framework(value string) RegistryOption {
	return func(registry *Registry) {
		registry.framework = value
	}
}

func BaseURL(value string) RegistryOption {
	return func(registry *Registry) {
		registry.service.BaseURL = value
	}
}

func Health(path string) RegistryOption {
	return func(registry *Registry) {
		registry.service.Health = path
	}
}

func SchemaRef(name string, schema any) RegistryOption {
	return func(registry *Registry) {
		registry.schemas[name] = schema
	}
}

func (registry *Registry) Command(name string, handler HandlerFunc, options ...EntryOption) {
	entry := Entry{
		Name:        name,
		Kind:        KindCommand,
		Path:        "/commands/" + name,
		Method:      "POST",
		Transaction: TransactionExternalManaged,
		Risk:        RiskWrite,
	}
	registry.add(entry, handler, options...)
}

func (registry *Registry) Query(name string, handler HandlerFunc, options ...EntryOption) {
	entry := Entry{
		Name:        name,
		Kind:        KindQuery,
		Path:        "/queries/" + name,
		Method:      "POST",
		Transaction: TransactionReadOnly,
		Risk:        RiskRead,
	}
	registry.add(entry, handler, options...)
}

func (registry *Registry) add(entry Entry, handler HandlerFunc, options ...EntryOption) {
	for _, option := range options {
		option(&entry)
	}
	registered := registeredEntry{entry: entry, handler: handler}
	registry.entries = append(registry.entries, registered)
	registry.lookup[lookupKey(entry.Kind, entry.Name)] = registered
}

func Description(value string) EntryOption {
	return func(entry *Entry) {
		entry.Description = value
	}
}

func Path(value string) EntryOption {
	return func(entry *Entry) {
		entry.Path = value
	}
}

func Method(value string) EntryOption {
	return func(entry *Entry) {
		entry.Method = value
	}
}

func InputSchema(schema any) EntryOption {
	return func(entry *Entry) {
		entry.InputSchema = schema
	}
}

func OutputSchema(schema any) EntryOption {
	return func(entry *Entry) {
		entry.OutputSchema = schema
	}
}

func Policy(value string) EntryOption {
	return func(entry *Entry) {
		entry.Policy = value
	}
}

func TenantScoped(value bool) EntryOption {
	return func(entry *Entry) {
		entry.TenantScoped = value
	}
}

func TransactionMode(value Transaction) EntryOption {
	return func(entry *Entry) {
		entry.Transaction = value
	}
}

func EntryRisk(value Risk) EntryOption {
	return func(entry *Entry) {
		entry.Risk = value
	}
}

func NeedsApproval(value bool) EntryOption {
	return func(entry *Entry) {
		entry.NeedsApproval = &value
	}
}

func Effects(values ...string) EntryOption {
	return func(entry *Entry) {
		entry.Effects = append([]string{}, values...)
	}
}

func ReadOnly() EntryOption {
	return func(entry *Entry) {
		entry.Transaction = TransactionReadOnly
		entry.Risk = RiskRead
	}
}

func (registry *Registry) Manifest(baseURL string) Manifest {
	service := registry.service
	if baseURL != "" {
		service.BaseURL = baseURL
	}
	entries := make([]Entry, 0, len(registry.entries))
	for _, registered := range registry.entries {
		entries = append(entries, registered.entry)
	}
	manifest := Manifest{
		ForgeProtocol: ProtocolVersion,
		Language:      "go",
		Framework:     registry.framework,
		Service:       service,
		Entries:       entries,
	}
	if len(registry.schemas) > 0 {
		manifest.Schemas = registry.schemas
	}
	return manifest
}

func (registry *Registry) MarshalManifest(baseURL string) ([]byte, error) {
	return json.MarshalIndent(registry.Manifest(baseURL), "", "  ")
}

func (registry *Registry) WriteManifest(writer io.Writer, baseURL string) error {
	encoded, err := registry.MarshalManifest(baseURL)
	if err != nil {
		return err
	}
	if _, err := writer.Write(encoded); err != nil {
		return err
	}
	_, err = writer.Write([]byte("\n"))
	return err
}

func Object(properties map[string]any, required ...string) Schema {
	schema := Schema{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func String() Schema {
	return Schema{"type": "string"}
}

func Boolean() Schema {
	return Schema{"type": "boolean"}
}

func Array(items any) Schema {
	return Schema{"type": "array", "items": items}
}

func lookupKey(kind EntryKind, name string) string {
	return string(kind) + ":" + name
}
