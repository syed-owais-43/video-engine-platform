import { readFileSync } from "node:fs";
import path from "node:path";

// Framewright's own engine-independent tools. Guides here are served live through get_guide
// (like an engine's reference docs); scripts ship inside every engine bundle under framewright/.
const DIR = path.join(process.cwd(), "shared", "framewright-tools");

export const SHARED_GUIDES: Record<string, string> = {
  "framewright/export.md": "export.md",
  "framewright/editor.md": "editor.md",
  "framewright/scenes.md": "scenes.md",
  "framewright/setup.md": "setup.md",
  "framewright/voice.md": "voice.md",
};

// Bump when setup.md asks for something new: every user's AI then runs the checklist again.
export const SETUP_VERSION = 2;

export const SHARED_SCRIPTS: Record<string, string> = {
  "framewright/fw-export.mjs": "fw-export.mjs",
  "framewright/fw-compose.mjs": "fw-compose.mjs",
};

export function readSharedFile(file: string): Buffer {
  return readFileSync(path.join(DIR, file));
}
