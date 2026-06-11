// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=e1270c6b68a3e4dbad4c20ca5fdc5a3036380b876faa10460383cea08f419474
CREATE SCHEMA IF NOT EXISTS forge;

CREATE OR REPLACE FUNCTION forge.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION forge.current_tenant_text()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.tenant_id', true), '')
$$;

CREATE OR REPLACE FUNCTION forge.current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.user_id', true), '')
$$;

CREATE OR REPLACE FUNCTION forge.current_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('forge.role', true), '')
$$;

ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forge_tickets_select" ON "tickets";
CREATE POLICY "forge_tickets_select"
ON "tickets"
FOR SELECT
USING ("tenant_id" = forge.current_tenant_id());

DROP POLICY IF EXISTS "forge_tickets_insert" ON "tickets";
CREATE POLICY "forge_tickets_insert"
ON "tickets"
FOR INSERT
WITH CHECK ("tenant_id" = forge.current_tenant_id());

DROP POLICY IF EXISTS "forge_tickets_update" ON "tickets";
CREATE POLICY "forge_tickets_update"
ON "tickets"
FOR UPDATE
USING ("tenant_id" = forge.current_tenant_id())
WITH CHECK ("tenant_id" = forge.current_tenant_id());

DROP POLICY IF EXISTS "forge_tickets_delete" ON "tickets";
CREATE POLICY "forge_tickets_delete"
ON "tickets"
FOR DELETE
USING ("tenant_id" = forge.current_tenant_id());
