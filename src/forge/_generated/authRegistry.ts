// @forge-generated generator=0.1.0-alpha.15 input=624aeb38a3511aee123d146b3484fd077c65e0c6548f1bd50890c71ee0c207ae content=737febf357ddca0e97368d301087ceced8b4223b213fde817240434825a77b1e
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
