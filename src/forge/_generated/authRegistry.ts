// @forge-generated generator=0.1.0-alpha.8 input=7e9241d38232a56e5930612085bbc6719ac771f9c0cd3f836ab721e9b76abb1d content=737febf357ddca0e97368d301087ceced8b4223b213fde817240434825a77b1e
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
