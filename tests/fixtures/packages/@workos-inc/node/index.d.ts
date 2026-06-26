export interface WorkOS {
  readonly baseURL: string;
  readonly clientId: string;
  readonly userManagement: {
    getAuthorizationUrl(input: {
      provider: "authkit";
      redirectUri: string;
      clientId: string;
      state?: string;
    }): string;
    authenticateWithCode(input: {
      code: string;
      clientId: string;
    }): Promise<{
      user: { id: string; email?: string; firstName?: string; lastName?: string };
      accessToken: string;
      refreshToken?: string;
      organizationId?: string;
      organizationMembershipId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
    }>;
  };
  readonly authorization: {
    check(input: {
      organizationMembershipId: string;
      permissionSlug: string;
      resourceTypeSlug: string;
      resourceExternalId: string;
    }): Promise<{ authorized: boolean }>;
    createResource(input: {
      organizationId: string;
      resourceTypeSlug: string;
      externalId: string;
      name: string;
      description?: string;
      parentResourceTypeSlug?: string;
      parentResourceExternalId?: string;
    }): Promise<unknown>;
    getResourceByExternalId(input: {
      organizationId: string;
      resourceTypeSlug: string;
      externalId: string;
    }): Promise<unknown>;
    updateResourceByExternalId(input: {
      organizationId: string;
      resourceTypeSlug: string;
      externalId: string;
      name?: string;
      description?: string;
      parentResourceTypeSlug?: string;
      parentResourceExternalId?: string;
    }): Promise<unknown>;
  };
}

export interface PublicWorkOS {
  readonly baseURL: string;
  readonly clientId: string;
}

export interface WorkOSOptions {
  clientId?: string;
}

export interface PublicClientOptions extends Omit<WorkOSOptions, "apiKey"> {
  clientId: string;
  apiKey?: never;
}

export interface ConfidentialClientOptions extends WorkOSOptions {
  apiKey: string;
  clientId: string;
}

export function createWorkOS(options: PublicClientOptions): PublicWorkOS;
export function createWorkOS(options: ConfidentialClientOptions): WorkOS;
