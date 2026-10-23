# framewright-companion

Local MCP server that lets Claude Desktop (and other chat apps without terminal access) make videos with Framewright.

It connects to your Framewright account with an API key and gives the AI:

- the Framewright tools (`list_engines`, `start_project`, `get_guide`, `list_styles`, `get_style`,
  `get_setup`, `finish_setup`, `get_voice`, `account_status`)
- `install_engine`: downloads an engine's helper scripts to `~/.framewright/engines`
- `get_assets`: installs the site's resource packs (sound effects, fonts, textures, Lottie) once into `~/.framewright/assets`
- `download_video`: downloads a reference video from a link with yt-dlp (installed by the setup checklist)
- `download_file`: saves a file from a link (e.g. a style's fonts) into the workspace
- `list_files`, `read_file`, `write_file`: limited to your workspace folder (installed engines are readable)
- `run_command`, `job_status`: run commands (PowerShell on Windows, bash elsewhere) starting in the workspace, with background jobs for long renders

Your API key is never passed to the commands it runs.

## Setup

Requires Node.js 20+. In Claude Desktop → Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "framewright": {
      "command": "npx",
      "args": ["-y", "framewright-companion"],
      "env": {
        "FRAMEWRIGHT_URL": "https://your-framewright-site",
        "FRAMEWRIGHT_API_KEY": "fw_...",
        "FRAMEWRIGHT_WORKSPACE": "C:\\Users\\you\\Videos\\Framewright"
      }
    }
  }
}
```

Restart Claude Desktop. Claude asks for approval before each tool call, so review commands before allowing them.

## Timeline editor

Run inside a video project folder (one that has `framewright.timeline.json`):

```
npx -y framewright-companion --editor --site https://your-framewright-site
```

It opens the Framewright editor in your browser, connected only to this computer. Keep the terminal open while editing.
Scenes that have a `scene.params.json` can be changed with sliders and re-rendered locally from the editor.
Options: `--project <folder>`, `--port <n>` (default 7717), `--no-open`. `FRAMEWRIGHT_URL` can replace `--site`.
In Claude Desktop, ask Claude to "open the Framewright editor" instead.
