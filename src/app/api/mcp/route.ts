import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp-server";
import { authenticateBearer } from "@/lib/tokens";
import { baseUrl } from "@/lib/config";
import { CORS_HEADERS, preflight } from "@/lib/oauth";

export const maxDuration = 60;

function unauthorized() {
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to Framewright or use an API key" }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource/api/mcp"`,
    },
  });
}

// Stateless Streamable HTTP: a fresh server per request, so it scales on serverless hosts.
async function handle(req: Request) {
  const identity = await authenticateBearer(req.headers.get("authorization"));
  if (!identity) return unauthorized();

  const server = createMcpServer(identity.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req, {
    authInfo: { token: "", clientId: identity.clientId ?? "api-key", scopes: ["mcp"], extra: { userId: identity.userId } },
  });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
