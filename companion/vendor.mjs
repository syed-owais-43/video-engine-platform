// Copies Framewright's shared tools into vendor/ so the published package is self-contained.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "shared", "framewright-tools");
mkdirSync(join(here, "vendor"), { recursive: true });
for (const f of ["fw-export.mjs", "fw-compose.mjs"]) copyFileSync(join(from, f), join(here, "vendor", f));
console.log("vendored shared tools");
