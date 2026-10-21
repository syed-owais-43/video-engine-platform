import { json, preflight, protectedResourceMetadata } from "@/lib/oauth";

// Served at both /.well-known/oauth-protected-resource and the path-suffixed
// /.well-known/oauth-protected-resource/api/mcp variant that some clients request.
export const GET = () => json(protectedResourceMetadata());
export const OPTIONS = preflight;
