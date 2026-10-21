import { baseUrl } from "./config";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, www-authenticate",
};

export const mcpResource = () => `${baseUrl()}/api/mcp`;

export function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [baseUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "Framewright",
  };
}

export function authorizationServerMetadata() {
  const b = baseUrl();
  return {
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    revocation_endpoint: `${b}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

// Dynamic client registration is open, so redirect URIs are restricted to schemes that
// can't execute script: https anywhere, http only on loopback, or native app schemes.
export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return !["javascript:", "data:", "vbscript:", "file:", "blob:", "about:"].includes(u.protocol);
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, "cache-control": "no-store", ...extra } });
}

export function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });
