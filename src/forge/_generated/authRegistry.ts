// @forge-generated generator=0.1.0-alpha.29 input=b7e3d13ed54a83a393e821d2a309404ee70f774794cda86187334aab958f539c content=737febf357ddca0e97368d301087ceced8b4223b213fde817240434825a77b1e
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
