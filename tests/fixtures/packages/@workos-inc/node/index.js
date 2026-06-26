export function createWorkOS(options) {
  return {
    baseURL: "https://api.workos.com",
    clientId: options.clientId,
    userManagement: {
      getAuthorizationUrl(input) {
        return `https://api.workos.com/user_management/authorize?provider=${input.provider}&client_id=${input.clientId}&redirect_uri=${input.redirectUri}`;
      },
      async authenticateWithCode() {
        return {
          user: { id: "user_1", email: "owner@acme.test" },
          accessToken: "access_token",
          refreshToken: "refresh_token",
          organizationId: "org_acme",
          organizationMembershipId: "om_acme_owner",
          role: "owner",
          roles: ["owner"],
          permissions: ["onboarding:read", "invitations:create"],
        };
      },
    },
    authorization: {
      async check() {
        return { authorized: true };
      },
      async createResource(input) {
        return { id: "authz_resource_fixture", ...input };
      },
      async getResourceByExternalId(input) {
        return { id: "authz_resource_fixture", ...input };
      },
      async updateResourceByExternalId(input) {
        return { id: "authz_resource_fixture", ...input };
      },
    },
  };
}
