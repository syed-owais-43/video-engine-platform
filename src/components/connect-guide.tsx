import { baseUrl } from "@/lib/config";
import { CopyBlock } from "./copy-block";

export const COMPANION_PACKAGE = "framewright-companion";

export function ConnectGuide({ apiKey }: { apiKey?: string }) {
  const url = `${baseUrl()}/api/mcp`;
  const key = apiKey ?? "fw_YOUR_API_KEY";
  const desktopConfig = JSON.stringify(
    {
      mcpServers: {
        framewright: {
          command: "npx",
          args: ["-y", COMPANION_PACKAGE],
          env: {
            FRAMEWRIGHT_URL: baseUrl(),
            FRAMEWRIGHT_API_KEY: key,
            FRAMEWRIGHT_WORKSPACE: "C:\\Users\\you\\Videos\\Framewright",
          },
        },
      },
    },
    null,
    2,
  );
  const cursorConfig = JSON.stringify({ mcpServers: { framewright: { url } } }, null, 2);
  const cursorKeyConfig = JSON.stringify({ mcpServers: { framewright: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);

  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="display text-3xl">Claude Code</h3>
          <span className="pill border-ok/40 text-ok">renders directly</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Run this once, then type <code className="font-mono text-paper">/mcp</code> inside Claude Code and choose <em>Authenticate</em> to sign in.
        </p>
        <div className="mt-4 space-y-3">
          <CopyBlock label="Sign in with your account (recommended)" code={`claude mcp add --transport http --scope user framewright ${url}`} />
          <CopyBlock
            label="Or use an API key"
            code={`claude mcp add --transport http --scope user framewright ${url} --header "Authorization: Bearer ${key}"`}
          />
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="display text-3xl">Cursor & other IDE agents</h3>
          <span className="pill border-ok/40 text-ok">renders directly</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Add to <code className="font-mono text-paper">~/.cursor/mcp.json</code> (or your agent&apos;s MCP settings). Cursor opens a sign-in window
          the first time.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <CopyBlock label="Sign in (OAuth)" code={cursorConfig} />
          <CopyBlock label="API key" code={cursorKeyConfig} />
        </div>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="display text-3xl">Claude Desktop</h3>
          <span className="pill border-warn/40 text-warn">needs the Companion</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Claude Desktop chat can&apos;t run commands on its own. The Framewright Companion is a small local MCP server that connects to your
          account and gives Claude a workspace folder to render in. Its file tools only work inside that folder, and commands start there.
          Needs Node.js 20+.
        </p>
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Open Claude Desktop → Settings → Developer → Edit Config.</li>
          <li>Paste the block below, set your workspace folder{apiKey ? "" : " and API key"}, save, and restart Claude.</li>
          <li>Claude asks before each command it runs. Approve the ones you&apos;re comfortable with.</li>
        </ol>
        <div className="mt-4">
          <CopyBlock label="claude_desktop_config.json" code={desktopConfig} />
        </div>
      </section>

      <section className="card">
        <h3 className="display text-3xl">Then just ask</h3>
        <CopyBlock
          code={`Use Framewright to make a 15-second 9:16 kinetic typography teaser for my podcast "Late Signals". Dark, grainy, orange accents. Reference: ./refs/style.mp4`}
        />
        <p className="mt-3 text-sm text-muted">
          Your AI checks your machine for Node, Python and FFmpeg first and asks before installing anything.
        </p>
      </section>

      <section className="card">
        <h3 className="display text-3xl">Fine-tune in the editor</h3>
        <p className="mt-2 text-sm text-muted">
          Move, trim and split clips, set levels, fix captions, drop in your own media, and leave change requests for your AI, all in
          the browser while the files stay on your computer. Ask your AI to <em>make this video editable in the Framewright
          editor</em>, then open it:
        </p>
        <div className="mt-4 space-y-3">
          <CopyBlock label="Claude Code, Cursor and others: run inside the project folder" code={`npx -y framewright-companion --editor --site ${baseUrl()}`} />
          <p className="text-sm text-muted">Claude Desktop: ask Claude to &ldquo;open the Framewright editor&rdquo;.</p>
        </div>
      </section>
    </div>
  );
}
