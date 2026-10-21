// Smoke test: node scripts/smoke-mcp.mjs  (env: FW_URL, FW_KEY)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.FW_URL ?? "http://localhost:3000";
const client = new Client({ name: "smoke", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.FW_KEY}` } },
}));
const show = (r) => r.content.map((c) => c.text).join("\n");
const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));
for (const [name, args] of JSON.parse(process.argv[2] ?? "[]")) {
  const r = await client.callTool({ name, arguments: args });
  const out = show(r);
  console.log(`\n== ${name} ${r.isError ? "(error)" : ""}\n${out.length > 1500 ? out.slice(0, 1500) + `\n…[${out.length} chars]` : out}`);
}
await client.close();
