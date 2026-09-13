// @forge-generated generator=0.1.0-alpha.63 input=128a75a60a7187f4b372ac9ffdd8c42ca3f2eac7281400dd5418fce8108ea630 content=737febf357ddca0e97368d301087ceced8b4223b213fde817240434825a77b1e
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
