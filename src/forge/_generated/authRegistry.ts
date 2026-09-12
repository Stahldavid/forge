// @forge-generated generator=0.1.0-alpha.63 input=593f2e9e12f4e6d0c8846dbd6c98a5de6b0813032749fe5c8264cf5fb791acb0 content=737febf357ddca0e97368d301087ceced8b4223b213fde817240434825a77b1e
export const authRegistry = {
  "algorithmsEnv": "FORGE_AUTH_ALGORITHMS",
  "audienceEnv": "FORGE_AUTH_AUDIENCE",
  "claims": {
    "email": "email",
    "name": "name",
    "permissions": "permissions",
    "role": "role",
    "roles": "roles",
    "tenantId": "tenant_id",
    "userId": "sub"
  },
  "defaultMode": "dev-headers",
  "issuerEnv": "FORGE_AUTH_ISSUER",
  "jwksUriEnv": "FORGE_AUTH_JWKS_URI",
  "modes": [
    "dev-headers",
    "jwt",
    "oidc",
    "disabled"
  ],
  "requiresTenant": false,
  "schemaVersion": "0.1.0"
} as const;
