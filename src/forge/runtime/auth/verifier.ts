import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import {
  FORGE_AUTH_INVALID_AUDIENCE,
  FORGE_AUTH_INVALID_ISSUER,
  FORGE_AUTH_INVALID_TOKEN,
  FORGE_AUTH_JWKS_FAILED,
  FORGE_AUTH_TOKEN_EXPIRED,
} from "../../compiler/diagnostics/codes.ts";
import type { ForgeAuthConfig } from "./config.ts";
import { ForgeAuthError } from "./errors.ts";
import type { VerifiedTokenMetadata } from "./claims.ts";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const oidcDiscoveryCache = new Map<string, Promise<string>>();

function getRemoteJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(jwksUri);
  if (cached) {
    return cached;
  }
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, jwks);
  return jwks;
}

function oidcMetadataUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export async function discoverOidcJwksUri(issuer: string): Promise<string> {
  const cached = oidcDiscoveryCache.get(issuer);
  if (cached) {
    return cached;
  }

  const discovered = (async () => {
    const response = await fetch(oidcMetadataUrl(issuer));
    if (!response.ok) {
      throw new ForgeAuthError(
        FORGE_AUTH_JWKS_FAILED,
        `OIDC discovery failed with status ${response.status}`,
      );
    }
    const metadata = (await response.json()) as { jwks_uri?: unknown };
    if (typeof metadata.jwks_uri !== "string" || metadata.jwks_uri.length === 0) {
      throw new ForgeAuthError(
        FORGE_AUTH_JWKS_FAILED,
        "OIDC discovery did not include jwks_uri",
      );
    }
    return metadata.jwks_uri;
  })();

  oidcDiscoveryCache.set(issuer, discovered);
  return discovered;
}

function classifyJoseError(error: unknown): ForgeAuthError {
  if (error instanceof ForgeAuthError) {
    return error;
  }
  if (error instanceof errors.JWTExpired) {
    return new ForgeAuthError(FORGE_AUTH_TOKEN_EXPIRED, "JWT token is expired", {
      cause: error,
    });
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    const claim = error.claim;
    if (claim === "iss") {
      return new ForgeAuthError(
        FORGE_AUTH_INVALID_ISSUER,
        "JWT issuer did not match Forge auth config",
        { cause: error },
      );
    }
    if (claim === "aud") {
      return new ForgeAuthError(
        FORGE_AUTH_INVALID_AUDIENCE,
        "JWT audience did not match Forge auth config",
        { cause: error },
      );
    }
  }
  if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JOSEError) {
    return new ForgeAuthError(
      FORGE_AUTH_INVALID_TOKEN,
      "JWT token could not be verified",
      { cause: error },
    );
  }
  return new ForgeAuthError(FORGE_AUTH_INVALID_TOKEN, "JWT token is invalid", {
    cause: error,
  });
}

function jwtPayloadToRecord(payload: JWTPayload): Record<string, unknown> {
  return { ...payload };
}

export async function verifyJwtToken(
  token: string,
  config: ForgeAuthConfig,
): Promise<{ payload: Record<string, unknown>; token: VerifiedTokenMetadata }> {
  try {
    const jwksUri =
      config.mode === "oidc"
        ? await discoverOidcJwksUri(config.issuer ?? "")
        : config.jwksUri;

    if (!jwksUri) {
      throw new ForgeAuthError(
        FORGE_AUTH_JWKS_FAILED,
        "FORGE_AUTH_JWKS_URI is required for JWT auth",
      );
    }

    const verified = await jwtVerify(token, getRemoteJwks(jwksUri), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
    });
    const payload = jwtPayloadToRecord(verified.payload);

    return {
      payload,
      token: {
        issuer: verified.payload.iss,
        audience: verified.payload.aud,
        subject: verified.payload.sub,
        expiresAt: verified.payload.exp,
        issuedAt: verified.payload.iat,
        authProvider: config.mode,
      },
    };
  } catch (error) {
    throw classifyJoseError(error);
  }
}
