import { authorizationServerMetadata, json, preflight } from "@/lib/oauth";

export const GET = () => json(authorizationServerMetadata());
export const OPTIONS = preflight;
