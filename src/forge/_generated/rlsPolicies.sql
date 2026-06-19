// @forge-generated generator=0.1.0-alpha.16 input=48860df69cb90d3dd3e4ab7f4a96c04ae6aaf13e86500ee34868ba58a6c23650 content=d53b7a15ff082fa13fe5c51368a06755ee24e057d2cdc2d4830e14eec0e7cbfa
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
