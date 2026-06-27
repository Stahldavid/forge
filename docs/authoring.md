# Authoring

ForgeOS provides **scaffolding commands** and **feature blueprints** so you can add schema, runtime entries, policies, and UI without hand-writing every file.

Always start with **`--dry-run --json`** when a plan touches schema, policies, or frontend wiring.

## `forge make`

List available primitives:

```bash
forge make list --json
forge make explain resource --json
```

Plans are stored under `.forge/make-plans/` with rollback support.

### Resource (full CRUD)

Scaffold schema, policies, commands, queries, liveQuery, optional UI, and tests:

```bash
forge make resource invoices \
  --fields amount:number,status:enum=draft+paid \
  --dry-run --json

forge make resource invoices \
  --fields amount:number,status:enum=draft+paid \
  --with-ui \
  --yes
```

`enum=open+closed` is the shell-safe form. The parenthesized form, such as `enum(open,closed)`, is also supported when quoted for your shell.

Creates or modifies:

| Area | Files |
|------|-------|
| Schema | `src/forge/schema.ts` |
| Policies | `src/policies.ts` |
| Runtime | `src/commands/*`, `src/queries/*`, `src/actions/*` |
| UI | `web/components/*`, routes when applicable |
| Tests | `tests/make-generated/*` |

### Individual primitives

```bash
forge make table invoices --fields amount:number,status:text
forge make field invoices.status --type enum --values draft,paid
forge make policy invoices.read --roles owner,admin,member
forge make command invoices.create --table invoices --policy invoices.create --emit invoice.created
forge make query invoices.list --table invoices --policy invoices.read
forge make action syncInvoice --event invoice.created
forge make workflow invoiceWorkflow --trigger invoice.created
```

### Frontend shell

```bash
forge make ui --framework vite --dry-run --json
forge make ui --framework vite --yes
forge make ui --framework nuxt --dry-run --json
forge make ui --framework nuxt --yes
```

Adds Vite + React + `ForgeProvider` or Nuxt + Vue composables + client bridge.

### AI chat surface

```bash
forge make ai-chat support --dry-run --json
forge make ai-chat support --yes
```

Generates:

- `src/ai/supportAgent.ts` (or similar) — agent definition
- `web/components/SupportAiChat.tsx` — chat UI
- Route under `web/app/` when applicable

See [AI — Scaffold chat UI](ai.md#scaffold-chat-ui).

### Apply and rollback

```bash
forge make apply <planId>
forge make rollback <planId>
```

## Feature blueprints

Blueprints describe multi-file features as JSON under `.forge/blueprints/`.

```bash
forge feature validate .forge/blueprints/billing.json --json
forge feature plan .forge/blueprints/billing.json
forge feature apply .forge/blueprints/billing.json --yes
```

Workflow:

1. **Validate** — schema and references
2. **Plan** — files, impact, risk level
3. **Review** — read plan output; use `--allow-high-risk` only when intentional
4. **Apply** — write source changes
5. **Verify** — `forge generate` + `forge verify --strict`

High-risk plans may touch schema, RLS, policies, and multiple runtime entries. Never apply unseen high-risk plans in production repos.

## After scaffolding

```bash
forge generate
forge check --json
forge inspect capabilities --json
forge verify --standard
```

For UI resources, also run:

```bash
forge dev --once --json
forge inspect frontend --json
```

## Agent workflow

When an agent scaffolds a feature:

```bash
forge do "add invoices resource with UI" --json
forge make resource invoices --fields ... --dry-run --json
# review plan
forge make resource invoices --fields ... --with-ui --yes
forge generate
forge verify --strict
```

See [Agent Workflow](agent-workflow.md).

## Related pages

- [Frontend](frontend.md) — hooks and capability map after `--with-ui`
- [Codemods](codemods.md) — refactors after schema changes
- [Security and Data](security-and-data.md) — policies and tenant fields
- [CLI](cli.md) — command reference
